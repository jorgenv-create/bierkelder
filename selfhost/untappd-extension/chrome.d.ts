type SyncExtensionSender={id?:string;origin?:string;url?:string;frameId?:number;tab?:{id?:number}};
declare const chrome:{
 runtime:{
  id:string;
  sendMessage(message:unknown):Promise<any>;
  onMessage:{addListener(listener:(message:any,sender:SyncExtensionSender,respond:(response:unknown)=>void)=>boolean|void):void};
 };
 storage:{session:{get(key:string):Promise<Record<string,unknown>>;set(items:Record<string,unknown>):Promise<void>;remove(key:string):Promise<void>}};
 tabs:{
  create(properties:{url:string;active:boolean}):Promise<{id?:number}>;
  update(id:number,properties:{url?:string;active?:boolean}):Promise<unknown>;
  remove(id:number):Promise<void>;
  sendMessage(id:number,message:unknown):Promise<unknown>;
  onRemoved:{addListener(listener:(id:number)=>void):void};
 };
};
