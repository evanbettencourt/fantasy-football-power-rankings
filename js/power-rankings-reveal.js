(function(){ "use strict"; window.initPowerRankingsReveal=function(){
var stage=document.getElementById("pr-stage"),board=stage&&stage.querySelector(".pr-board"),button=document.getElementById("pr-reveal");if(!stage||!board||!button)return;
button.replaceWith(button.cloneNode(true));button=document.getElementById("pr-reveal");
var cards=Array.prototype.slice.call(board.querySelectorAll(".pr-card"));stage.classList.remove("armed","running","revealed");cards.forEach(function(c){c.style.order="";c.style.transform="";c.style.transition="";c.classList.remove("moving","landed");});
if(!cards.length){button.hidden=true;return;}button.hidden=false;
var reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function n(c,a){return parseInt(c.getAttribute(a),10)||0;}var max=cards.reduce(function(m,c){return Math.max(m,Math.abs(n(c,"data-move")));},0);
function finish(){stage.classList.remove("armed","running");stage.classList.add("revealed");cards.forEach(function(c){c.style.order="";c.style.transform="";c.style.transition="";c.classList.remove("moving");});button.style.display="none";}
if(reduced||max===0){button.addEventListener("click",finish,{once:true});return;}
cards.forEach(function(c){c.style.order=String(n(c,"data-prev"));});stage.classList.add("armed");
button.addEventListener("click",function(){button.disabled=true;stage.classList.add("running");setTimeout(function(){
var first=cards.map(function(c){return c.getBoundingClientRect().top;});button.style.display="none";cards.forEach(function(c){c.style.order="";});var last=cards.map(function(c){return c.getBoundingClientRect().top;});
cards.forEach(function(c,i){c.style.transition="none";c.style.transform="translateY("+(first[i]-last[i])+"px)";});void board.offsetHeight;var longest=0;
cards.forEach(function(c){var move=n(c,"data-move"),duration=Math.round(1750*(.55+.45*Math.abs(move)/max)),delay=move<0?120:0,ease=move<0?"cubic-bezier(.55,.06,.68,.19)":"cubic-bezier(.22,1,.36,1)";if(move)c.classList.add("moving");c.style.transition="transform "+duration+"ms "+ease+" "+delay+"ms";c.style.transform="";longest=Math.max(longest,duration+delay);function land(e){if(e&&e.propertyName!=="transform")return;c.removeEventListener("transitionend",land);c.style.transition="";c.style.transform="";c.classList.remove("moving");if(move<0){c.classList.add("landed");setTimeout(function(){c.classList.remove("landed");},220);}}if(move){c.addEventListener("transitionend",land);setTimeout(land,duration+delay+120);}});
setTimeout(function(){var blurbs=Array.prototype.slice.call(stage.querySelectorAll(".bl-wrap"));blurbs.forEach(function(el){el.style.height="0px";});cards.slice().sort(function(a,b){return n(a,"data-final")-n(b,"data-final");}).forEach(function(c,i){c.style.setProperty("--roll",i*30+"ms");});stage.classList.remove("armed");stage.classList.add("revealed");void stage.offsetHeight;
setTimeout(function(){blurbs.forEach(function(el){var h=el.scrollHeight;el.style.transition="none";el.style.height="0px";void el.offsetHeight;el.style.transition="height 560ms cubic-bezier(.22,1,.36,1)";el.style.height=h+"px";setTimeout(function(){el.style.transition="";el.style.height="";},620);});setTimeout(function(){stage.classList.remove("running");},900);},900);
},longest+40);
},190);},{once:true});
};})();