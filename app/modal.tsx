'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';

export default function Modal({children,onClose,title,wide=false}:{children:ReactNode;onClose:()=>void;title:string;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current;
  dialog?.showModal();
  return ()=>dialog?.close();
 },[]);
 return <dialog ref={ref} aria-label={title} className={'modal '+(wide?'wide':'')} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
  <div className="modal-top"><div><span className="eyebrow">DE BIERKELDER</span><h2>{title}</h2></div><button type="button" className="icon-btn" aria-label="Sluiten" onClick={onClose}><X size={22}/></button></div>{children}
 </dialog>;
}
