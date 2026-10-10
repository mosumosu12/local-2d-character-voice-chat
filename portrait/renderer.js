// Shared drawing only. Coordinates and textures belong to the character config.
export class PortraitRenderer {
 constructor(canvas,config){this.canvas=canvas;this.config=config;this.gl=canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:false});if(!this.gl)throw Error('WebGL2を利用できません');}
 async init(){
  const gl=this.gl,cfg=this.config;
  const vertex=`#version 300 es
  precision highp float;in vec2 p;out vec2 uv;uniform vec2 size,pivot;uniform float tilt,breath,hair,time;
  uniform float naturalMotion,hairL,hairR,hairGain,nod,chest;
  uniform vec4 hairRegionL,hairRegionR,faceProtect,chestRegion;
  uniform vec2 hairShapeL,hairShapeR;
  // 呼吸: breathOn=1 の時だけ。breathShape=(首y, 肩y, 支点y=下端側で動かない線, 0) / breathAmount=(縦伸縮率, 持ち上げpx, 髪の追従率)
  // v2: breathShape.w=持ち上げが消え始めるy(胸) / breathExtra=(肩の追加上がりpx, 胸の横ふくらみ率, ふくらみ中心y, ふくらみ半高さ) / breathNod=吐く時の頷きで顔の中心が下がるpx
  uniform float breathOn,breathBody,breathHead,breathHair,breathNod;uniform vec4 breathShape,breathExtra;uniform vec3 breathAmount;
  float strandMask(vec4 r,vec2 shape,float side){
   float along=clamp((p.y-r.x)/max(1.,r.y-r.x),0.,1.);float inner=mix(r.z,r.w,along);
   float across=side<0.?1.-smoothstep(inner-shape.x,inner,p.x):smoothstep(inner,inner+shape.x,p.x);
   float vertical=smoothstep(r.x,r.x+60.,p.y)*(1.-smoothstep(r.y-25.,r.y+45.,p.y));
   vec2 face=abs((p-faceProtect.xy)/faceProtect.zw);float protect=1.-smoothstep(1.,1.18,max(face.x,face.y));
   return across*vertical*(1.-protect)*smoothstep(0.,.35,along);
  }
  float strand(vec4 r,vec2 shape,float side,float force){
   float along=clamp((p.y-r.x)/max(1.,r.y-r.x),0.,1.);
   float inner=mix(r.z,r.w,along);
   float across=side<0.?1.-smoothstep(inner-shape.x,inner,p.x):smoothstep(inner,inner+shape.x,p.x);
   float vertical=smoothstep(r.x,r.x+60.,p.y)*(1.-smoothstep(r.y-25.,r.y+45.,p.y));
   vec2 face=abs((p-faceProtect.xy)/faceProtect.zw);
   float protect=1.-smoothstep(1.,1.18,max(face.x,face.y));
   float drive=force*hairGain*(hair/.6)*shape.y;
   // Soft limiting avoids a frozen/clipped tip and limits mesh folding at the inner edge.
   float limit=shape.x*.48;drive=drive/sqrt(1.+drive*drive/(limit*limit));
   return drive*across*vertical*along*along*(1.-protect);
  }
  void main(){uv=p/size;vec2 q=p;float w=1.-smoothstep(pivot.y,pivot.y+100.,p.y);float a=tilt*.01745329252*w;vec2 d=p-pivot;q=vec2(cos(a)*d.x-sin(a)*d.y,sin(a)*d.x+cos(a)*d.y)+pivot;
  if(naturalMotion>.5){q.x+=strand(hairRegionL,hairShapeL,-1.,hairL)+strand(hairRegionR,hairShapeR,1.,hairR);
   q.y+=nod*1.4*w;float cw=1.-smoothstep(.4,1.,length((p-chestRegion.xy)/chestRegion.zw));q.y+=chest*10.*cw;
   if(breathOn>.5){
    // 下端側(支点y)から上だけを縦に伸ばす＋肩から上を少し持ち上げる。支点より下は 0 ＝ 机の裏の下端は動かない。
    float neckY=breathShape.x,shoulderY=breathShape.y,anchorY=breathShape.z,liftY=breathShape.w;
    float top=breathAmount.x*(anchorY-shoulderY)+breathAmount.y+breathExtra.x;
    // 主役は「胸から上ごと持ち上がる」平行移動。縦伸びは控えめ。肩は胸よりさらに少し上がる。支点y(机の線のすぐ下)より下は 0。
    float torso=breathAmount.x*(anchorY-clamp(p.y,shoulderY,anchorY))+breathAmount.y*(1.-smoothstep(liftY,anchorY,p.y))+breathExtra.x*(1.-smoothstep(shoulderY,liftY,p.y));
    // 胸の高さを中心に横へわずかに膨らむ（腕・髪の外側までは広げない）
    float sw=exp(-pow((p.y-breathExtra.z)/max(1.,breathExtra.w),2.))*(1.-smoothstep(220.,360.,abs(p.x-chestRegion.x)))*(1.-smoothstep(anchorY-40.,anchorY,p.y));
    q.x+=(p.x-chestRegion.x)*breathExtra.y*breathBody*sw;
    // 頭は胴より少し遅れて追従（breathHead は renderer 側のばねで遅らせた値）。首で滑らかにつなぐ。
    float hw=1.-smoothstep(neckY,shoulderY,p.y);
    // 吐く時の小さな頷き: 顔の中心ほど少し下がる（首を軸に前へ傾く見え方）
    float fd=1.-smoothstep(0.,1.6,length((p-faceProtect.xy)/faceProtect.zw));
    float d=mix(breathBody*torso,breathHead*top-breathNod*fd,hw);
    // 垂れ髪は頭からさらに遅れてついてくる（毛先が胴に置いていかれないように）。
    float hm=max(strandMask(hairRegionL,hairShapeL,-1.),strandMask(hairRegionR,hairShapeR,1.))*breathAmount.z;
    d=mix(d,breathHair*top,hm);
    q.y-=d;
   }else q.y-=breath*4.*(1.-smoothstep(pivot.y+420.,size.y,p.y));
  }else{float outer=smoothstep(size.x*.18,size.x*.32,abs(p.x-size.x*.5));float lengthW=smoothstep(230.,500.,p.y)*(1.-smoothstep(760.,850.,p.y));q.x+=hair*outer*lengthW*sin(time*1.7+p.y*.004)*2.;q.y-=breath*2.*(1.-smoothstep(900.,1400.,p.y));}
  gl_Position=vec4(q.x/size.x*2.-1.,1.-q.y/size.y*2.,0,1);}`;
  const fragment=`#version 300 es
  precision highp float;in vec2 uv;out vec4 color;uniform sampler2D base,variant;
  uniform sampler2D smileTexture,troubledTexture,angryClosedTexture,angryOpenTexture,troubledBlinkTexture,angryBlinkTexture;
  uniform vec3 expressionWeights;uniform vec4 expressionEyeL,expressionEyeR,expressionMouth,angryClosure;
  uniform vec2 expressionSampleY,angryCornerX;uniform float smileRest;uniform float settle;
  uniform vec2 expressionTextureSize;
  uniform vec3 expressionGains[18];
  uniform vec4 smileSources[3],troubledSources[3],angryClosedSources[3],angryOpenSources[3],troubledBlinkSources[3],angryBlinkSources[3];
  uniform vec2 size,mouthSampleY,mouthCornerX;uniform vec4 eyeL,eyeR,mouthRegion,mouthClosure,eyeLSource,eyeRSource,mouthSource;uniform float blink,mouth,alignVariant;
  float region(vec2 q,vec4 r){return 1.-smoothstep(.78,1.,length((q-r.xy)/r.zw));}
  vec2 expressionUV(vec2 q,vec4 source,vec2 target){return (source.xy+(q-target)*source.zw)/expressionTextureSize;}
  float eyeBox(vec2 p,vec4 r){vec2 d=abs((p-r.xy)/r.zw);return (1.-smoothstep(.92,1.,d.x))*(1.-smoothstep(.92,1.,d.y));}
  vec3 blinkEye(sampler2D opened,sampler2D closed,vec2 p,vec4 src,vec4 shut,vec4 mask,vec2 center,vec2 dims,vec3 gain,vec3 shutGain,float amount){
   vec3 original=texture(opened,(src.xy+(p-center)*src.zw)/dims).rgb*gain;
   vec3 resting=texture(closed,(shut.xy+(p-center)*shut.zw)/dims).rgb*shutGain;
   // No synthetic half-eye or skin plate: those produced extra lashes and
   // visible rectangular skin bands. Use one intact drawing per blink frame.
   if(amount<.5)return original;
   // Keep the original open outline fully inside the opaque replacement.
   // Feather only beyond the eye contours, never through a lash or iris.
   return mix(original,resting,eyeBox(p,vec4(mask.xy,mask.z*1.12,mask.w*1.1)));
  }
  void main(){vec2 p=uv*size;vec4 b=texture(base,uv),v=texture(variant,uv);float el=region(p,eyeL),er=region(p,eyeR),e=max(el,er);
  if(alignVariant>0.){vec4 src=el>=er?eyeLSource:eyeRSource;vec2 center=el>=er?eyeL.xy:eyeR.xy;v=texture(variant,(src.xy+(p-center)*src.zw)/size);}
  b.rgb=mix(b.rgb,v.rgb,e*blink);
  if(settle>0.){bool left=el>=er;vec4 mask=left?eyeL:eyeR;vec4 src=vec4(mask.xy,1.,1.);vec4 shut=alignVariant>0.?(left?eyeLSource:eyeRSource):src;
   b.rgb=blinkEye(base,variant,p,src,shut,mask,mask.xy,size,vec3(1.),vec3(1.),blink);}
  // The blend mask and the safe source crop serve different purposes.
  // Sampling the whole mask can stretch the nose shadow into a vertical line.
  float opening=max(.08,mouth),centerY=mouthRegion.y,blendEnd=.06;
  // Opt-in closure follows the original lip curve instead of flattening it.
  // xy: corner heights, z: curve sag, w: end of blend into the open texture.
  if(mouthClosure.w>0.){float t=clamp((p.x-mouthCornerX.x)/(mouthCornerX.y-mouthCornerX.x),0.,1.);
   float closedY=mix(mouthClosure.x,mouthClosure.y,t)+4.*t*(1.-t)*mouthClosure.z;
   centerY=mix(closedY,mouthRegion.y,mouth);blendEnd=mouthClosure.w;}
  vec2 mp=p;mp.y=clamp(mouthRegion.y+(p.y-centerY)/opening,mouthSampleY.x,mouthSampleY.y);
  if(alignVariant>0.)mp=mouthSource.xy+(mp-mouthRegion.xy)*mouthSource.zw;
  vec3 mc=texture(variant,mp/size).rgb;
  b.rgb=mix(b.rgb,mc,region(p,mouthRegion)*smoothstep(0.,blendEnd,mouth));
  // Emotions only replace eye/brow and mouth regions. Neutral keeps the legacy path.
  float total=dot(expressionWeights,vec3(1.));
  if(total>0.){
   int ei=region(p,expressionEyeL)>=region(p,expressionEyeR)?0:1;
   vec2 ec=ei==0?eyeL.xy:eyeR.xy;
   vec3 s=texture(smileTexture,expressionUV(p,smileSources[ei],ec)).rgb,t=texture(troubledTexture,expressionUV(p,troubledSources[ei],ec)).rgb,a=texture(angryClosedTexture,expressionUV(p,angryClosedSources[ei],ec)).rgb;
   float em=max(region(p,expressionEyeL),region(p,expressionEyeR));
   // Dedicated blink art preserves the expression's brows and eyelid attitude.
   float eb=blink;
   s*=expressionGains[ei];t*=expressionGains[3+ei];a*=expressionGains[6+ei];
   t=mix(t,texture(troubledBlinkTexture,expressionUV(p,troubledBlinkSources[ei],ec)).rgb*expressionGains[12+ei],eb);a=mix(a,texture(angryBlinkTexture,expressionUV(p,angryBlinkSources[ei],ec)).rgb*expressionGains[15+ei],eb);
   if(settle>0.){vec4 mask=ei==0?eyeL:eyeR;
    t=blinkEye(troubledTexture,troubledBlinkTexture,p,troubledSources[ei],troubledBlinkSources[ei],mask,ec,expressionTextureSize,expressionGains[3+ei],expressionGains[12+ei],blink);
    a=blinkEye(angryClosedTexture,angryBlinkTexture,p,angryClosedSources[ei],angryBlinkSources[ei],mask,ec,expressionTextureSize,expressionGains[6+ei],expressionGains[15+ei],blink);}
   vec3 eyes=(s*expressionWeights.x+t*expressionWeights.y+a*expressionWeights.z)/total;
   b.rgb=mix(b.rgb,eyes,em*min(1.,total));
   float rest=mix(smileRest,.08,blink);float happyOpening=rest+(1.-rest)*mouth;
   vec2 sp=p;sp.y=clamp(expressionMouth.y+(p.y-expressionMouth.y)/max(.08,happyOpening),expressionSampleY.x,expressionSampleY.y);
   vec3 sm=texture(smileTexture,expressionUV(sp,smileSources[2],expressionMouth.xy)).rgb*expressionGains[2];
   float ax=clamp((p.x-angryCornerX.x)/(angryCornerX.y-angryCornerX.x),0.,1.);
   float ay=mix(angryClosure.x,angryClosure.y,ax)+4.*ax*(1.-ax)*angryClosure.z;
   vec2 ap=p;ap.y=clamp(expressionMouth.y+(p.y-mix(ay,expressionMouth.y,mouth))/max(.08,mouth),expressionSampleY.x,expressionSampleY.y);
   vec3 am=mix(texture(angryClosedTexture,expressionUV(p,angryClosedSources[2],expressionMouth.xy)).rgb*expressionGains[8],texture(angryOpenTexture,expressionUV(ap,angryOpenSources[2],expressionMouth.xy)).rgb*expressionGains[11],smoothstep(0.,angryClosure.w,mouth));
   vec3 mouths=(sm*expressionWeights.x+texture(troubledTexture,expressionUV(p,troubledSources[2],expressionMouth.xy)).rgb*expressionGains[5]*expressionWeights.y+am*expressionWeights.z)/total;
   b.rgb=mix(b.rgb,mouths,region(p,expressionMouth)*min(1.,total));
  }
  color=b;}`;
  const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const prog=gl.createProgram();gl.attachShader(prog,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));this.program=prog;gl.useProgram(prog);
  this.uniforms={};for(const n of ['naturalMotion','hairL','hairR','hairGain','nod','chest','hairRegionL','hairRegionR','hairShapeL','hairShapeR','faceProtect','chestRegion','base','variant','size','pivot','tilt','breath','hair','time','eyeL','eyeR','mouthRegion','mouthSampleY','mouthCornerX','mouthClosure','eyeLSource','eyeRSource','mouthSource','alignVariant','blink','mouth','smileTexture','troubledTexture','angryClosedTexture','angryOpenTexture','expressionWeights','expressionEyeL','expressionEyeR','expressionMouth','expressionSampleY','smileRest','angryClosure','angryCornerX','settle','breathOn','breathBody','breathHead','breathHair','breathShape','breathAmount','breathExtra','breathNod'])this.uniforms[n]=gl.getUniformLocation(prog,n);
  const vertices=[],nx=64,ny=96;for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)for(const [dx,dy] of [[0,0],[1,0],[0,1],[0,1],[1,0],[1,1]])vertices.push((x+dx)*cfg.width/nx,(y+dy)*cfg.height/ny);
  this.count=vertices.length/2;this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao);const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);const loc=gl.getAttribLocation(prog,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  this.textures=[];for(const [i,url] of [cfg.textures.base,cfg.textures.blinkMouth].entries()){const im=new Image();im.src=url;await im.decode();if(im.width!==cfg.width||im.height!==cfg.height)throw Error('画像寸法と設定が一致しません');const tx=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tx);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);this.textures.push(tx);}
  gl.uniform1i(this.uniforms.base,0);gl.uniform1i(this.uniforms.variant,1);gl.uniform2f(this.uniforms.size,cfg.width,cfg.height);gl.uniform2fv(this.uniforms.pivot,cfg.headPivot);for(const key of ['eyeL','eyeR','mouthRegion'])gl.uniform4fv(this.uniforms[key],cfg[key]);
  gl.uniform2fv(this.uniforms.mouthSampleY,cfg.mouthSampleY??[cfg.mouthRegion[1]-cfg.mouthRegion[3],cfg.mouthRegion[1]+cfg.mouthRegion[3]]);
  gl.uniform2fv(this.uniforms.mouthCornerX,cfg.mouthCornerX??[cfg.mouthRegion[0]-cfg.mouthRegion[2],cfg.mouthRegion[0]+cfg.mouthRegion[2]]);
  gl.uniform4fv(this.uniforms.mouthClosure,cfg.mouthClosure??[0,0,0,0]);
  // Optional local registration for face-only variants; existing aligned assets keep their old UV path.
  gl.uniform1f(this.uniforms.alignVariant,cfg.variantSources?1:0);
  for(const [name,region] of [['eyeLSource','eyeL'],['eyeRSource','eyeR'],['mouthSource','mouthRegion']])gl.uniform4fv(this.uniforms[name],cfg.variantSources?.[name]??[...cfg[region].slice(0,2),1,1]);
  const nm=cfg.naturalMotion;
  gl.uniform4fv(this.uniforms.hairRegionL,nm?.left?.slice(0,4)??[0,1,0,0]);
  gl.uniform4fv(this.uniforms.hairRegionR,nm?.right?.slice(0,4)??[0,1,0,0]);
  gl.uniform2fv(this.uniforms.hairShapeL,nm?.left?.slice(4)??[100,0]);
  gl.uniform2fv(this.uniforms.hairShapeR,nm?.right?.slice(4)??[100,0]);
  gl.uniform4fv(this.uniforms.faceProtect,nm?.faceProtect??[0,0,1,1]);
  gl.uniform4fv(this.uniforms.chestRegion,nm?.chestRegion??[0,0,1,1]);
  // 呼吸: model.json の "breathing" があれば新方式（無ければ従来どおり）。数値は全部キャラ別に上書き可。
  const br=cfg.breathing?{neckY:cfg.headPivot[1],shoulderY:cfg.headPivot[1]+100,anchorY:Math.min(cfg.height,cfg.headPivot[1]+580),stretch:.004,rise:6.5,shoulderLift:4,liftY:cfg.headPivot[1]+180,swell:.008,swellY:(cfg.naturalMotion?.chestRegion?.[1]??cfg.headPivot[1]+210),swellHalfHeight:140,nodDeg:.8,nodDepth:160,hairFollow:.85,headLag:{freq:1.4,damping:.9},hairLag:{freq:1,damping:.65},...cfg.breathing}:null;
  this.breathing=br;this.breathSprings={head:{x:0,v:0},hair:{x:0,v:0},nod:0,last:null};
  globalThis.PortraitMotion&&(globalThis.PortraitMotion.breathingConfig=br);
  gl.uniform1f(this.uniforms.breathOn,br?1:0);
  if(br){gl.uniform4fv(this.uniforms.breathShape,[br.neckY,br.shoulderY,br.anchorY,br.liftY]);gl.uniform4fv(this.uniforms.breathExtra,[br.shoulderLift,br.swell,br.swellY,br.swellHalfHeight]);if(!cfg.naturalMotion)gl.uniform4fv(this.uniforms.chestRegion,[cfg.width/2,br.swellY,1,1]);gl.uniform3fv(this.uniforms.breathAmount,[br.stretch,br.rise,br.hairFollow]);}
  const expr=cfg.expressions;
  const names=['smile','troubled','angryClosed','angryOpen','troubledBlink','angryBlink'];
  for(const name of ['troubledBlinkTexture','angryBlinkTexture'])this.uniforms[name]=gl.getUniformLocation(prog,name);
  for(const [index,name] of names.entries()){
   const unit=index+2;
   if(expr){
    const im=new Image();im.src=expr.textures[name];await im.decode();const dimensions=expr.textureSize??[cfg.width,cfg.height];if(im.width!==dimensions[0]||im.height!==dimensions[1])throw Error('表情画像の寸法が一致しません');
    const tx=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tx);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);this.textures.push(tx);
   }
   gl.uniform1i(this.uniforms[name+'Texture'],expr?unit:0);
   const defaults=[cfg.eyeL,cfg.eyeR,expr?.mouthRegion??cfg.mouthRegion].map(r=>[r[0],r[1],1,1]);
   gl.uniform4fv(gl.getUniformLocation(prog,name+'Sources[0]'),new Float32Array((expr?.sources?.[name]??defaults).flat()));
  }
  gl.uniform2fv(gl.getUniformLocation(prog,'expressionTextureSize'),expr?.textureSize??[cfg.width,cfg.height]);
  gl.uniform3fv(gl.getUniformLocation(prog,'expressionGains[0]'),new Float32Array(names.flatMap(n=>expr?.featureGains?.[n]?.flat()??Array(9).fill(1))));
  for(const [u,key] of [['expressionEyeL','eyeL'],['expressionEyeR','eyeR'],['expressionMouth','mouthRegion']])gl.uniform4fv(this.uniforms[u],expr?.[key]??cfg[key]);
  gl.uniform2fv(this.uniforms.expressionSampleY,expr?.mouthSampleY??cfg.mouthSampleY??[0,1]);
  this.smileRestBase=expr?.smileMouthRest??.55;gl.uniform1f(this.uniforms.smileRest,this.smileRestBase);
  gl.uniform4fv(this.uniforms.angryClosure,expr?.angryMouthClosure??[0,0,0,.28]);
  gl.uniform2fv(this.uniforms.angryCornerX,expr?.angryMouthCornerX??[0,1]);
 }
 // 呼吸の量 A（breathing 既定 .5 の話し中ピークで 1）を、頭→髪の順にばねで遅らせて渡す。
 breathUniforms(state,time){
  const gl=this.gl,b=this.breathing,s=this.breathSprings,A=Math.max(0,Math.min(2,(Number(state.breath)||0)*2));
  const dt=s.last===null?0:Math.max(0,Math.min(.1,time-s.last));s.last=time;
  if(dt===0){s.head.x=s.hair.x=A;s.head.v=s.hair.v=0;}
  const steps=Math.max(1,Math.ceil(dt*240)),h=dt/steps;
  const follow=(o,target,{freq,damping})=>{const w=2*Math.PI*freq;o.v+=(w*w*(target-o.x)-2*damping*w*o.v)*h;o.x+=o.v*h;};
  for(let i=0;i<steps;i++){follow(s.head,A,b.headLag);follow(s.hair,s.head.x,b.hairLag);}
  // 吐いている（頭が下がっている）間だけ頷く。速度から 0..1 を作って滑らかにする。
  const exhale=Math.max(0,Math.min(1,-s.head.v/1.2));s.nod+=(exhale-s.nod)*(1-Math.exp(-dt*4));
  gl.uniform1f(this.uniforms.breathNod,Math.sin(b.nodDeg*Math.PI/180)*b.nodDepth*s.nod);
  gl.uniform1f(this.uniforms.breathBody,A);gl.uniform1f(this.uniforms.breathHead,s.head.x);gl.uniform1f(this.uniforms.breathHair,s.hair.x);
  this.breathDebug={body:A,head:s.head.x,hair:s.hair.x};
 }
 draw(state,time){const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.bindVertexArray(this.vao);for(const [i,tx] of this.textures.entries()){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,tx);}for(const n of ['blink','mouth','tilt','breath','hair','settle','hairL','hairR','hairGain','nod','chest'])gl.uniform1f(this.uniforms[n],state[n]||0);if(this.uniforms.smileRest)gl.uniform1f(this.uniforms.smileRest,Number.isFinite(state.smileRest)?state.smileRest:(this.smileRestBase??.55));gl.uniform1f(this.uniforms.naturalMotion,this.config.naturalMotion&&state.motionVersion===1?1:0);gl.uniform3fv(this.uniforms.expressionWeights,this.config.expressions?(state.expressionWeights??[0,0,0]):[0,0,0]);gl.uniform1f(this.uniforms.time,time);if(this.breathing)this.breathUniforms(state,time);gl.drawArrays(gl.TRIANGLES,0,this.count);}
}
