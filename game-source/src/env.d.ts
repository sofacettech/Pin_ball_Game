/// <reference types="vite/client" />

interface Window { sofacetGameLoader?: {stylesReady:Promise<unknown>;show():void;ready():void;fail(reason?:unknown,phase?:string):void;cancel():void;isActive():boolean;setActive(value:boolean):void} }
