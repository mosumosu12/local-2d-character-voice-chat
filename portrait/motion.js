// 動きの決め方（まばたき・口・首かしげ）。画像の座標は持たない。
import './secondary.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class MotionController{
 constructor(){this.currentMouth=0;this.blinkAt=-10;this.last=-1;this.secondary=new globalThis.PortraitMotion.Controller();this.currentTilt=null;}
 blink(t){this.blinkAt=t;}
 nod(){this.secondary.nod();}
 update(t,dt,input){
  // The first animation timestamp can precede the initialization timestamp.
  dt=Math.max(0,dt);
  const cycle=t%4.6;let b=cycle<.18?Math.sin(cycle/.18*Math.PI):0;
  const manual=t-this.blinkAt;if(manual>=0&&manual<.2)b=Math.max(b,Math.sin(manual/.2*Math.PI));
  const target=input.audioActive?input.audioMouth:input.demo?Math.max(0,Math.sin(t*8)+.35*Math.sin(t*17))*.75:input.mouth;
  this.currentMouth+=(clamp(target,0,1)-this.currentMouth)*(1-Math.exp(-dt*24));
  const music=input.audioActive?Math.sin(input.audioTime*input.bpm/60*Math.PI*.5)*1.6:0;
  const targetTilt=clamp(Number.isFinite(input.testTilt)?input.testTilt:input.tilt+(input.demo?Math.sin(t*1.1)*1.4:music),-3,3);
  this.currentTilt??=targetTilt;this.currentTilt+=(targetTilt-this.currentTilt)*(1-Math.exp(-dt*12));
  const natural=this.secondary.update({Head_Tilt:this.currentTilt,Mouth_Open:this.currentMouth},dt,{breathing:input.breathing,hairGain:input.hairGain??3,speechEnabled:input.audioActive||input.demo,utteranceId:input.utteranceId??null});
  return {blink:clamp(b,0,1),mouth:this.currentMouth,tilt:this.currentTilt,breath:natural.Breath,hair:input.hair,
   hairL:natural.Hair_L,hairR:natural.Hair_R,hairGain:natural.Hair_Gain,nod:natural.Head_Nod,chest:natural.Chest_Sway,motionVersion:1};
 }
}
