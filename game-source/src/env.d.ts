/// <reference types="vite/client" />

interface Window { sofacetGameLoader?: {stylesReady:Promise<unknown>;show():void;ready():void;progress(value:number):void;fail(reason?:unknown,phase?:string):void;cancel():void;isActive():boolean;setActive(value:boolean):void} }
