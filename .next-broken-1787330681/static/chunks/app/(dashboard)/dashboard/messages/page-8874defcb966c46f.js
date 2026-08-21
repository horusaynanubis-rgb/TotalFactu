(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[7233],{1471:function(e,t,r){Promise.resolve().then(r.bind(r,9417))},9417:function(e,t,r){"use strict";r.r(t),r.d(t,{default:function(){return m}});var a=r(7437),s=r(2265),n=r(6070),i=r(5974),o=r(9801),l=r(1817),d=r(2934),c=r(5186),u=r(4508);function m(){let[e,t]=(0,s.useState)([]),[r,m]=(0,s.useState)(!0),[p,f]=(0,s.useState)(null);(0,s.useEffect)(()=>{fetch("/api/messages").then(e=>e.json()).then(e=>t(e.messages??[])).catch(()=>c.ZP.error("Error cargando mensajes")).finally(()=>m(!1))},[]);let g=async e=>{if(f(e),!e.read_at)try{(await fetch(`/api/messages/${e.id}/read`,{method:"PATCH"})).ok&&t(t=>t.map(t=>t.id===e.id?{...t,read_at:new Date().toISOString()}:t))}catch{}},h=e.filter(e=>!e.read_at).length;return(0,a.jsxs)("div",{className:"space-y-6",children:[(0,a.jsxs)("div",{children:[(0,a.jsxs)("h1",{className:"text-2xl font-bold tracking-tight flex items-center gap-2",children:[(0,a.jsx)(o.Z,{className:"h-6 w-6"}),"Mensajes",h>0&&(0,a.jsxs)(i.C,{className:"bg-red-500 hover:bg-red-500 text-white",children:[h," nuevos"]})]}),(0,a.jsx)("p",{className:"text-muted-foreground",children:"Mensajes de tu gestor\xeda"})]}),r?(0,a.jsx)("div",{className:"flex justify-center py-12",children:(0,a.jsx)(l.Z,{className:"h-8 w-8 animate-spin text-muted-foreground"})}):0===e.length?(0,a.jsx)(n.Zb,{children:(0,a.jsxs)(n.aY,{className:"py-16 text-center",children:[(0,a.jsx)(o.Z,{className:"h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30"}),(0,a.jsx)("p",{className:"text-muted-foreground",children:"No tienes mensajes todav\xeda."})]})}):(0,a.jsxs)("div",{className:"grid md:grid-cols-[320px_1fr] gap-4 items-start",children:[(0,a.jsx)("div",{className:"space-y-1",children:e.map(e=>(0,a.jsxs)("button",{onClick:()=>g(e),className:(0,u.cn)("w-full text-left rounded-lg border p-3 transition-colors hover:bg-accent",p?.id===e.id&&"bg-accent border-primary",!e.read_at&&"border-primary/40 bg-primary/5"),children:[(0,a.jsxs)("div",{className:"flex items-center justify-between gap-2 mb-1",children:[(0,a.jsx)("span",{className:(0,u.cn)("text-sm font-medium truncate",!e.read_at&&"font-semibold"),children:e.gestoria_company.name}),!e.read_at&&(0,a.jsx)("span",{className:"h-2 w-2 rounded-full bg-blue-500 flex-shrink-0"})]}),(0,a.jsx)("div",{className:"flex items-center gap-1.5 mb-1",children:(0,a.jsx)(i.C,{variant:"outline",className:"text-xs px-1.5 py-0",children:e.subject})}),(0,a.jsx)("p",{className:"text-xs text-muted-foreground truncate",children:e.body}),(0,a.jsx)("p",{className:"text-xs text-muted-foreground mt-1",children:new Date(e.created_at).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric"})})]},e.id))}),p?(0,a.jsxs)(n.Zb,{children:[(0,a.jsx)(n.Ol,{className:"pb-3",children:(0,a.jsxs)("div",{className:"flex items-start justify-between gap-3",children:[(0,a.jsxs)("div",{children:[(0,a.jsx)(n.ll,{className:"text-base",children:p.gestoria_company.name}),(0,a.jsx)("p",{className:"text-sm text-muted-foreground mt-0.5",children:new Date(p.created_at).toLocaleDateString("es-ES",{weekday:"long",day:"numeric",month:"long",year:"numeric"})})]}),(0,a.jsx)(i.C,{variant:"outline",children:p.subject})]})}),(0,a.jsxs)(n.aY,{children:[(0,a.jsx)("div",{className:"bg-muted rounded-lg p-4",children:(0,a.jsx)("p",{className:"text-sm whitespace-pre-wrap",children:p.body})}),p.read_at&&(0,a.jsxs)("div",{className:"flex items-center gap-1.5 mt-3 text-xs text-muted-foreground",children:[(0,a.jsx)(d.Z,{className:"h-3.5 w-3.5 text-green-500"}),"Le\xeddo el ",new Date(p.read_at).toLocaleDateString("es-ES")]})]})]}):(0,a.jsx)("div",{className:"hidden md:flex items-center justify-center h-48 rounded-lg border border-dashed text-muted-foreground text-sm",children:"Selecciona un mensaje para leerlo"})]})]})}},5974:function(e,t,r){"use strict";r.d(t,{C:function(){return o}});var a=r(7437);r(2265);var s=r(7712),n=r(4508);let i=(0,s.j)("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",{variants:{variant:{default:"border-transparent bg-primary text-primary-foreground",secondary:"border-transparent bg-secondary text-secondary-foreground",destructive:"border-transparent bg-destructive text-destructive-foreground",outline:"text-foreground",success:"border-transparent bg-green-100 text-green-800",warning:"border-transparent bg-yellow-100 text-yellow-800",info:"border-transparent bg-blue-100 text-blue-800"}},defaultVariants:{variant:"default"}});function o({className:e,variant:t,...r}){return(0,a.jsx)("div",{className:(0,n.cn)(i({variant:t}),e),...r})}},6070:function(e,t,r){"use strict";r.d(t,{Ol:function(){return o},SZ:function(){return d},Zb:function(){return i},aY:function(){return c},eW:function(){return u},ll:function(){return l}});var a=r(7437),s=r(2265),n=r(4508);let i=s.forwardRef(({className:e,...t},r)=>(0,a.jsx)("div",{ref:r,className:(0,n.cn)("rounded-lg border bg-card text-card-foreground shadow-sm",e),...t}));i.displayName="Card";let o=s.forwardRef(({className:e,...t},r)=>(0,a.jsx)("div",{ref:r,className:(0,n.cn)("flex flex-col space-y-1.5 p-6",e),...t}));o.displayName="CardHeader";let l=s.forwardRef(({className:e,...t},r)=>(0,a.jsx)("h3",{ref:r,className:(0,n.cn)("text-2xl font-semibold leading-none tracking-tight",e),...t}));l.displayName="CardTitle";let d=s.forwardRef(({className:e,...t},r)=>(0,a.jsx)("p",{ref:r,className:(0,n.cn)("text-sm text-muted-foreground",e),...t}));d.displayName="CardDescription";let c=s.forwardRef(({className:e,...t},r)=>(0,a.jsx)("div",{ref:r,className:(0,n.cn)("p-6 pt-0",e),...t}));c.displayName="CardContent";let u=s.forwardRef(({className:e,...t},r)=>(0,a.jsx)("div",{ref:r,className:(0,n.cn)("flex items-center p-6 pt-0",e),...t}));u.displayName="CardFooter"},4508:function(e,t,r){"use strict";r.d(t,{cn:function(){return n},o0:function(){return l},p6:function(){return o},xG:function(){return i}});var a=r(1994),s=r(3335);function n(...e){return(0,s.m6)((0,a.W)(e))}function i(e,t="EUR"){return new Intl.NumberFormat("en-GB",{style:"currency",currency:t}).format(e)}function o(e){return new Date(e).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}function l(e){return new Date(e).toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}},9205:function(e,t,r){"use strict";r.d(t,{Z:function(){return l}});var a=r(2265);let s=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),n=(...e)=>e.filter((e,t,r)=>!!e&&r.indexOf(e)===t).join(" ");var i={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};let o=(0,a.forwardRef)(({color:e="currentColor",size:t=24,strokeWidth:r=2,absoluteStrokeWidth:s,className:o="",children:l,iconNode:d,...c},u)=>(0,a.createElement)("svg",{ref:u,...i,width:t,height:t,stroke:e,strokeWidth:s?24*Number(r)/Number(t):r,className:n("lucide",o),...c},[...d.map(([e,t])=>(0,a.createElement)(e,t)),...Array.isArray(l)?l:[l]])),l=(e,t)=>{let r=(0,a.forwardRef)(({className:r,...i},l)=>(0,a.createElement)(o,{ref:l,iconNode:t,className:n(`lucide-${s(e)}`,r),...i}));return r.displayName=`${e}`,r}},2934:function(e,t,r){"use strict";r.d(t,{Z:function(){return a}});let a=(0,r(9205).Z)("CircleCheck",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]])},9801:function(e,t,r){"use strict";r.d(t,{Z:function(){return a}});let a=(0,r(9205).Z)("Inbox",[["polyline",{points:"22 12 16 12 14 15 10 15 8 12 2 12",key:"o97t9d"}],["path",{d:"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",key:"oot6mr"}]])},1817:function(e,t,r){"use strict";r.d(t,{Z:function(){return a}});let a=(0,r(9205).Z)("LoaderCircle",[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]])},5186:function(e,t,r){"use strict";let a,s;r.d(t,{x7:function(){return eu},ZP:function(){return em}});var n,i=r(2265);let o={data:""},l=e=>{if("object"==typeof window){let t=(e?e.querySelector("#_goober"):window._goober)||Object.assign(document.createElement("style"),{innerHTML:" ",id:"_goober"});return t.nonce=window.__nonce__,t.parentNode||(e||document.head).appendChild(t),t.firstChild}return e||o},d=/(?:([\u0080-\uFFFF\w-%@]+) *:? *([^{;]+?);|([^;}{]*?) *{)|(}\s*)/g,c=/\/\*[^]*?\*\/|  +/g,u=/\n+/g,m=(e,t)=>{let r="",a="",s="";for(let n in e){let i=e[n];"@"==n[0]?"i"==n[1]?r=n+" "+i+";":a+="f"==n[1]?m(i,n):n+"{"+m(i,"k"==n[1]?"":t)+"}":"object"==typeof i?a+=m(i,t?t.replace(/([^,])+/g,e=>n.replace(/([^,]*:\S+\([^)]*\))|([^,])+/g,t=>/&/.test(t)?t.replace(/&/g,e):e?e+" "+t:t)):n):null!=i&&(n=/^--/.test(n)?n:n.replace(/[A-Z]/g,"-$&").toLowerCase(),s+=m.p?m.p(n,i):n+":"+i+";")}return r+(t&&s?t+"{"+s+"}":s)+a},p={},f=e=>{if("object"==typeof e){let t="";for(let r in e)t+=r+f(e[r]);return t}return e},g=(e,t,r,a,s)=>{var n;let i=f(e),o=p[i]||(p[i]=(e=>{let t=0,r=11;for(;t<e.length;)r=101*r+e.charCodeAt(t++)>>>0;return"go"+r})(i));if(!p[o]){let t=i!==e?e:(e=>{let t,r,a=[{}];for(;t=d.exec(e.replace(c,""));)t[4]?a.shift():t[3]?(r=t[3].replace(u," ").trim(),a.unshift(a[0][r]=a[0][r]||{})):a[0][t[1]]=t[2].replace(u," ").trim();return a[0]})(e);p[o]=m(s?{["@keyframes "+o]:t}:t,r?"":"."+o)}let l=r&&p.g?p.g:null;return r&&(p.g=p[o]),n=p[o],l?t.data=t.data.replace(l,n):-1===t.data.indexOf(n)&&(t.data=a?n+t.data:t.data+n),o},h=(e,t,r)=>e.reduce((e,a,s)=>{let n=t[s];if(n&&n.call){let e=n(r),t=e&&e.props&&e.props.className||/^go/.test(e)&&e;n=t?"."+t:e&&"object"==typeof e?e.props?"":m(e,""):!1===e?"":e}return e+a+(null==n?"":n)},"");function x(e){let t=this||{},r=e.call?e(t.p):e;return g(r.unshift?r.raw?h(r,[].slice.call(arguments,1),t.p):r.reduce((e,r)=>Object.assign(e,r&&r.call?r(t.p):r),{}):r,l(t.target),t.g,t.o,t.k)}x.bind({g:1});let y,b,v,w=x.bind({k:1});function j(e,t){let r=this||{};return function(){let a=arguments;function s(n,i){let o=Object.assign({},n),l=o.className||s.className;r.p=Object.assign({theme:b&&b()},o),r.o=/ *go\d+/.test(l),o.className=x.apply(r,a)+(l?" "+l:""),t&&(o.ref=i);let d=e;return e[0]&&(d=o.as||e,delete o.as),v&&d[0]&&v(o),y(d,o)}return t?t(s):s}}var N=e=>"function"==typeof e,k=(e,t)=>N(e)?e(t):e,E=(a=0,()=>(++a).toString()),C=()=>{if(void 0===s&&"u">typeof window){let e=matchMedia("(prefers-reduced-motion: reduce)");s=!e||e.matches}return s},_=new Map,$=e=>{if(_.has(e))return;let t=setTimeout(()=>{_.delete(e),z({type:4,toastId:e})},1e3);_.set(e,t)},D=e=>{let t=_.get(e);t&&clearTimeout(t)},S=(e,t)=>{switch(t.type){case 0:return{...e,toasts:[t.toast,...e.toasts].slice(0,20)};case 1:return t.toast.id&&D(t.toast.id),{...e,toasts:e.toasts.map(e=>e.id===t.toast.id?{...e,...t.toast}:e)};case 2:let{toast:r}=t;return e.toasts.find(e=>e.id===r.id)?S(e,{type:1,toast:r}):S(e,{type:0,toast:r});case 3:let{toastId:a}=t;return a?$(a):e.toasts.forEach(e=>{$(e.id)}),{...e,toasts:e.toasts.map(e=>e.id===a||void 0===a?{...e,visible:!1}:e)};case 4:return void 0===t.toastId?{...e,toasts:[]}:{...e,toasts:e.toasts.filter(e=>e.id!==t.toastId)};case 5:return{...e,pausedAt:t.time};case 6:let s=t.time-(e.pausedAt||0);return{...e,pausedAt:void 0,toasts:e.toasts.map(e=>({...e,pauseDuration:e.pauseDuration+s}))}}},O=[],Z={toasts:[],pausedAt:void 0},z=e=>{Z=S(Z,e),O.forEach(e=>{e(Z)})},A={blank:4e3,error:4e3,success:2e3,loading:1/0,custom:4e3},L=(e={})=>{let[t,r]=(0,i.useState)(Z);(0,i.useEffect)(()=>(O.push(r),()=>{let e=O.indexOf(r);e>-1&&O.splice(e,1)}),[t]);let a=t.toasts.map(t=>{var r,a;return{...e,...e[t.type],...t,duration:t.duration||(null==(r=e[t.type])?void 0:r.duration)||(null==e?void 0:e.duration)||A[t.type],style:{...e.style,...null==(a=e[t.type])?void 0:a.style,...t.style}}});return{...t,toasts:a}},P=(e,t="blank",r)=>({createdAt:Date.now(),visible:!0,type:t,ariaProps:{role:"status","aria-live":"polite"},message:e,pauseDuration:0,...r,id:(null==r?void 0:r.id)||E()}),I=e=>(t,r)=>{let a=P(t,e,r);return z({type:2,toast:a}),a.id},M=(e,t)=>I("blank")(e,t);M.error=I("error"),M.success=I("success"),M.loading=I("loading"),M.custom=I("custom"),M.dismiss=e=>{z({type:3,toastId:e})},M.remove=e=>z({type:4,toastId:e}),M.promise=(e,t,r)=>{let a=M.loading(t.loading,{...r,...null==r?void 0:r.loading});return e.then(e=>(M.success(k(t.success,e),{id:a,...r,...null==r?void 0:r.success}),e)).catch(e=>{M.error(k(t.error,e),{id:a,...r,...null==r?void 0:r.error})}),e};var R=(e,t)=>{z({type:1,toast:{id:e,height:t}})},H=()=>{z({type:5,time:Date.now()})},T=e=>{let{toasts:t,pausedAt:r}=L(e);(0,i.useEffect)(()=>{if(r)return;let e=Date.now(),a=t.map(t=>{if(t.duration===1/0)return;let r=(t.duration||0)+t.pauseDuration-(e-t.createdAt);if(r<0){t.visible&&M.dismiss(t.id);return}return setTimeout(()=>M.dismiss(t.id),r)});return()=>{a.forEach(e=>e&&clearTimeout(e))}},[t,r]);let a=(0,i.useCallback)(()=>{r&&z({type:6,time:Date.now()})},[r]),s=(0,i.useCallback)((e,r)=>{let{reverseOrder:a=!1,gutter:s=8,defaultPosition:n}=r||{},i=t.filter(t=>(t.position||n)===(e.position||n)&&t.height),o=i.findIndex(t=>t.id===e.id),l=i.filter((e,t)=>t<o&&e.visible).length;return i.filter(e=>e.visible).slice(...a?[l+1]:[0,l]).reduce((e,t)=>e+(t.height||0)+s,0)},[t]);return{toasts:t,handlers:{updateHeight:R,startPause:H,endPause:a,calculateOffset:s}}},F=w`
from {
  transform: scale(0) rotate(45deg);
	opacity: 0;
}
to {
 transform: scale(1) rotate(45deg);
  opacity: 1;
}`,B=w`
from {
  transform: scale(0);
  opacity: 0;
}
to {
  transform: scale(1);
  opacity: 1;
}`,G=w`
from {
  transform: scale(0) rotate(90deg);
	opacity: 0;
}
to {
  transform: scale(1) rotate(90deg);
	opacity: 1;
}`,W=j("div")`
  width: 20px;
  opacity: 0;
  height: 20px;
  border-radius: 10px;
  background: ${e=>e.primary||"#ff4b4b"};
  position: relative;
  transform: rotate(45deg);

  animation: ${F} 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
  animation-delay: 100ms;

  &:after,
  &:before {
    content: '';
    animation: ${B} 0.15s ease-out forwards;
    animation-delay: 150ms;
    position: absolute;
    border-radius: 3px;
    opacity: 0;
    background: ${e=>e.secondary||"#fff"};
    bottom: 9px;
    left: 4px;
    height: 2px;
    width: 12px;
  }

  &:before {
    animation: ${G} 0.15s ease-out forwards;
    animation-delay: 180ms;
    transform: rotate(90deg);
  }
`,Y=w`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`,U=j("div")`
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 2px solid;
  border-radius: 100%;
  border-color: ${e=>e.secondary||"#e0e0e0"};
  border-right-color: ${e=>e.primary||"#616161"};
  animation: ${Y} 1s linear infinite;
`,q=w`
from {
  transform: scale(0) rotate(45deg);
	opacity: 0;
}
to {
  transform: scale(1) rotate(45deg);
	opacity: 1;
}`,V=w`
0% {
	height: 0;
	width: 0;
	opacity: 0;
}
40% {
  height: 0;
	width: 6px;
	opacity: 1;
}
100% {
  opacity: 1;
  height: 10px;
}`,J=j("div")`
  width: 20px;
  opacity: 0;
  height: 20px;
  border-radius: 10px;
  background: ${e=>e.primary||"#61d345"};
  position: relative;
  transform: rotate(45deg);

  animation: ${q} 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
  animation-delay: 100ms;
  &:after {
    content: '';
    box-sizing: border-box;
    animation: ${V} 0.2s ease-out forwards;
    opacity: 0;
    animation-delay: 200ms;
    position: absolute;
    border-right: 2px solid;
    border-bottom: 2px solid;
    border-color: ${e=>e.secondary||"#fff"};
    bottom: 6px;
    left: 6px;
    height: 10px;
    width: 6px;
  }
`,K=j("div")`
  position: absolute;
`,Q=j("div")`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 20px;
  min-height: 20px;
`,X=w`
from {
  transform: scale(0.6);
  opacity: 0.4;
}
to {
  transform: scale(1);
  opacity: 1;
}`,ee=j("div")`
  position: relative;
  transform: scale(0.6);
  opacity: 0.4;
  min-width: 20px;
  animation: ${X} 0.3s 0.12s cubic-bezier(0.175, 0.885, 0.32, 1.275)
    forwards;
`,et=({toast:e})=>{let{icon:t,type:r,iconTheme:a}=e;return void 0!==t?"string"==typeof t?i.createElement(ee,null,t):t:"blank"===r?null:i.createElement(Q,null,i.createElement(U,{...a}),"loading"!==r&&i.createElement(K,null,"error"===r?i.createElement(W,{...a}):i.createElement(J,{...a})))},er=e=>`
0% {transform: translate3d(0,${-200*e}%,0) scale(.6); opacity:.5;}
100% {transform: translate3d(0,0,0) scale(1); opacity:1;}
`,ea=e=>`
0% {transform: translate3d(0,0,-1px) scale(1); opacity:1;}
100% {transform: translate3d(0,${-150*e}%,-1px) scale(.6); opacity:0;}
`,es=j("div")`
  display: flex;
  align-items: center;
  background: #fff;
  color: #363636;
  line-height: 1.3;
  will-change: transform;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1), 0 3px 3px rgba(0, 0, 0, 0.05);
  max-width: 350px;
  pointer-events: auto;
  padding: 8px 10px;
  border-radius: 8px;
`,en=j("div")`
  display: flex;
  justify-content: center;
  margin: 4px 10px;
  color: inherit;
  flex: 1 1 auto;
  white-space: pre-line;
`,ei=(e,t)=>{let r=e.includes("top")?1:-1,[a,s]=C()?["0%{opacity:0;} 100%{opacity:1;}","0%{opacity:1;} 100%{opacity:0;}"]:[er(r),ea(r)];return{animation:t?`${w(a)} 0.35s cubic-bezier(.21,1.02,.73,1) forwards`:`${w(s)} 0.4s forwards cubic-bezier(.06,.71,.55,1)`}},eo=i.memo(({toast:e,position:t,style:r,children:a})=>{let s=e.height?ei(e.position||t||"top-center",e.visible):{opacity:0},n=i.createElement(et,{toast:e}),o=i.createElement(en,{...e.ariaProps},k(e.message,e));return i.createElement(es,{className:e.className,style:{...s,...r,...e.style}},"function"==typeof a?a({icon:n,message:o}):i.createElement(i.Fragment,null,n,o))});n=i.createElement,m.p=void 0,y=n,b=void 0,v=void 0;var el=({id:e,className:t,style:r,onHeightUpdate:a,children:s})=>{let n=i.useCallback(t=>{if(t){let r=()=>{a(e,t.getBoundingClientRect().height)};r(),new MutationObserver(r).observe(t,{subtree:!0,childList:!0,characterData:!0})}},[e,a]);return i.createElement("div",{ref:n,className:t,style:r},s)},ed=(e,t)=>{let r=e.includes("top"),a=e.includes("center")?{justifyContent:"center"}:e.includes("right")?{justifyContent:"flex-end"}:{};return{left:0,right:0,display:"flex",position:"absolute",transition:C()?void 0:"all 230ms cubic-bezier(.21,1.02,.73,1)",transform:`translateY(${t*(r?1:-1)}px)`,...r?{top:0}:{bottom:0},...a}},ec=x`
  z-index: 9999;
  > * {
    pointer-events: auto;
  }
`,eu=({reverseOrder:e,position:t="top-center",toastOptions:r,gutter:a,children:s,containerStyle:n,containerClassName:o})=>{let{toasts:l,handlers:d}=T(r);return i.createElement("div",{style:{position:"fixed",zIndex:9999,top:16,left:16,right:16,bottom:16,pointerEvents:"none",...n},className:o,onMouseEnter:d.startPause,onMouseLeave:d.endPause},l.map(r=>{let n=r.position||t,o=ed(n,d.calculateOffset(r,{reverseOrder:e,gutter:a,defaultPosition:t}));return i.createElement(el,{id:r.id,key:r.id,onHeightUpdate:d.updateHeight,className:r.visible?ec:"",style:o},"custom"===r.type?k(r.message,r):s?s(r):i.createElement(eo,{toast:r,position:n}))}))},em=M}},function(e){e.O(0,[6009,2971,2117,1744],function(){return e(e.s=1471)}),_N_E=e.O()}]);