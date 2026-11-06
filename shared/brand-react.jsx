import {BrandText} from '../assets/brand-text.jsx';
import {Children,cloneElement,isValidElement,createElement} from 'react';
import {brandParts} from './brand-text.ts';
export function brandText(value){
 if(typeof value==='string')return brandParts(value).map((part,index)=>part.brand?createElement('span',{className:'brand-word',key:index},part.text):part.text);
 if(Array.isArray(value))return Children.map(value,brandText);
 if(isValidElement(value)&&value.type!==BrandText&&value.props.children!==undefined&&!['option','textarea','script','style'].includes(value.type))return cloneElement(value,{},brandText(value.props.children));
 return value;
}
