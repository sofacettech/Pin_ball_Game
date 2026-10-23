export const brandParts=(text:string)=>text.split(/(\bSO\s*\/?\s*FACET\b(?!\.[a-z]))/gi).map((text,index)=>({text,brand:index%2===1}));
export function setBrandText(element:HTMLElement,text:string){
 element.replaceChildren(...brandParts(text).map(part=>{
  if(!part.brand)return document.createTextNode(part.text);
  const span=document.createElement('span');span.className='brand-word';span.textContent=part.text;return span;
 }));
}
