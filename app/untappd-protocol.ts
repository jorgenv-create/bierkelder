import type {UntappdPage} from './untappd';
export const syncChannel='bierkelder-untappd-v1';
declare const __BIERKELDER_ORIGIN__:string;
export const cellarOrigin=__BIERKELDER_ORIGIN__;
export const untappdOrigin='https://untappd.com';
export const maxSyncBeers=500;
export const syncExtensionVersion=4;
export type SyncBeer={id:string;key:string;name:string;brewery:string;vintage:string;auto:boolean;url:string};
export type SyncCandidate={url:string;name:string;brewery:string;style:string};
export type SyncIssue={id:string;key:string;candidates:SyncCandidate[];reason:'choice'|'no-match'|'page-error'};
export type SyncReply=
 | {kind:'available';version?:number}
 | {kind:'login'}
 | {kind:'progress';completed:number}
 | {kind:'result';results:{id:string;key:string;page:UntappdPage}[];blocked:boolean;issues?:SyncIssue[]}
 | {kind:'error';message:string};
