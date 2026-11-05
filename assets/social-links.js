const socials=document.querySelector('.social-links');
if(socials){
 const trigger=socials.querySelector('.social-trigger'),profiles=socials.querySelector('.social-profiles'),mobile=matchMedia('(max-width:600px)');
 const setOpen=open=>{socials.toggleAttribute('data-open',open);trigger.setAttribute('aria-expanded',String(open))};
 trigger.addEventListener('click',()=>setOpen(!socials.hasAttribute('data-open')));
 document.addEventListener('click',event=>{if(!socials.contains(event.target))setOpen(false)});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&socials.hasAttribute('data-open')){setOpen(false);trigger.focus();event.preventDefault()}});
 profiles.addEventListener('click',event=>{if(event.target.closest('a'))setOpen(false)});
 mobile.addEventListener('change',()=>setOpen(false));
}
