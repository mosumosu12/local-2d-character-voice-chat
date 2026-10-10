// 首かしげ・呼吸・髪・胸・うなずきの揺れ（ばねで計算）。
(()=>{
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const soft=v=>{v=clamp(v,0,1);return v*v*v*(10+v*(-15+6*v));};
const gate=(t,a,b)=>soft((t-a)/.9)*(1-soft((t-b)/1.05));
class Spring{
 constructor(f,z){this.w=2*Math.PI*f;this.z=z;this.x=0;this.v=0;}
 step(target,dt){this.v+=(this.w*this.w*(target-this.x)-2*this.z*this.w*this.v)*dt;this.x+=this.v*dt;return this.x;}
}
// 呼吸（全キャラ共通）: model.json の "breathing" があるキャラだけ新方式。
//   renderer.init() が globalThis.PortraitMotion.breathingConfig にキャラ別設定を置く。無ければ従来の5.4秒波形のまま。
//   出力 Breath は 0..1（breathing スライダー既定 .5 で話し中のピーク≒.5）。形の変え方は renderer 側が受け持つ。
const BREATH_DEFAULTS={period:4.2,speakPeriod:3.1,amp:.72,speakAmp:1,jitter:.07,ampJitter:.08,blendSeconds:.9,speakHold:1.2};
function breathConfig(){const c=globalThis.PortraitMotion?.breathingConfig;return c?{...BREATH_DEFAULTS,...c}:null;}
class Controller{
 constructor(){this.breathPhase=0;this.speakBlend=0;this.lastVoice=-10;this.time=0;this.previousTilt=null;this.previousBreath=0;this.left=new Spring(1.55,.78);this.right=new Spring(1.4,.8);this.bangs=new Spring(2.1,.85);this.chest=new Spring(.85,.72);this.head=new Spring(1.6,.85);this.nodAt=-10;this.lastSpeech=-10;this.utterance=null;this.nodCount=0;}
 nod(){if(this.time-this.nodAt<1.6)return false;this.nodAt=this.time;this.nodCount++;return true;}
 update(p,dt,{breathing=.5,hairGain=3,speechEnabled=false,utteranceId=null}={}){
  dt=clamp(Number(dt)||0,0,.2);
  if(utteranceId&&utteranceId!==this.utterance)this.nod();
  this.utterance=utteranceId;
  if(speechEnabled&&p.Mouth_Open>.13){if(this.time-this.lastSpeech>.65)this.nod();this.lastSpeech=this.time;}
  const tilt=Number(p.Head_Tilt)||0,old=this.previousTilt??tilt;
  const velocity=dt>0?clamp((tilt-old)/dt,-15,15):0;
  this.previousTilt=tilt;
  const steps=Math.max(1,Math.ceil(dt*120)),h=dt/steps;let breath=this.previousBreath;
  const bc=breathConfig();
  if(bc&&speechEnabled)this.lastVoice=this.time;
  for(let i=0;i<steps;i++){
   this.time+=h;
   if(bc){
    // 話している（口パク入力がある／途切れて speakHold 秒以内）→ 速く・大きく。切り替えは blendSeconds で滑らかに。
    const speaking=this.time-this.lastVoice<bc.speakHold?1:0;
    this.speakBlend+=(speaking-this.speakBlend)*(1-Math.exp(-h/Math.max(.05,bc.blendSeconds)));
    const t=this.time,s=this.speakBlend;
    const wobble=1+bc.jitter*(.6*Math.sin(t*.21)+.4*Math.sin(t*.37+1.3));
    const period=(bc.period+(bc.speakPeriod-bc.period)*s)*wobble;
    this.breathPhase=(this.breathPhase+h/Math.max(.5,period))%1;
    const amp=(bc.amp+(bc.speakAmp-bc.amp)*s)*(1+bc.ampJitter*Math.sin(t*.17+.4));
    breath=clamp(clamp(breathing,0,1)*amp*(.5-.5*Math.cos(this.breathPhase*Math.PI*2)),0,1);
   }else{
   const phase=(this.time%5.4)/5.4;
   breath=clamp(breathing,0,1)*(phase<.4?ease(phase/.4):1-ease((phase-.4)/.6));
   }
   const breathVelocity=h>0?clamp((breath-this.previousBreath)/h,-1.5,1.5):0;
   const since=this.time-this.nodAt;
   const pulse=ease(since/.35)*(1-ease((since-.45)/.45));
   const nod=this.head.step(2.2*pulse,h),drive=-velocity*.045+nod*.035;
   this.left.step(drive+.06*Math.sin(this.time*1.05),h);
   this.right.step(drive+.05*Math.sin(this.time*.97+.5),h);
   this.bangs.step(drive*.42,h);this.chest.step(breathVelocity*.4+nod*.028,h);
   this.previousBreath=breath;
  }
  return {...p,Hair_L:clamp(this.left.x,-.8,.8),Hair_R:clamp(this.right.x,-.8,.8),Bangs:clamp(this.bangs.x,-.4,.4),
   Breath:breath,Chest_Sway:clamp(this.chest.x,-.22,.22),Head_Nod:clamp(this.head.x,0,2.5),Hair_Gain:clamp(hairGain,0,5),Motion_Version:1};
 }
}
globalThis.PortraitMotion={Controller,testTilt:t=>3*(gate(t,3,6)-gate(t,10,13)+gate(t,17,20))};
})();
