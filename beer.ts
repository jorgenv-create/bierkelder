import { z } from 'zod';
import { untappdBeerLink, untappdPageSchema } from './untappd';
export { untappdBeerLink, untappdCatalogSchema, untappdPageSyncSchema, untappdSyncKey } from './untappd';
const day = z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/);
const drinkYear = z.number().int().min(1900).max(2199).optional();
const link = z.string().max(1000).refine(v => !v || /^https:\/\//.test(v), 'Gebruik een https-link');
export const maxPhotoLength = 200_000;
const photo = z.string().max(maxPhotoLength).regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/, 'Gebruik een geldige JPEG-foto');
const untappdLink = z.string().trim().max(1000).refine(value => {
  return !value||(/^https:\/\//.test(value)&&!!untappdBeerLink(value));
}, 'Gebruik de HTTPS-link naar de bierpagina op Untappd');
export const beerSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(160), brewery: z.string().max(160), style: z.string().max(100),
  barcode: z.string().regex(/^$|^\d{8,14}$/), abv: z.number().min(0).max(100).nullable(), volume: z.number().min(1).max(30000),
  vintage: z.string().max(30), quantity: z.number().int().min(0).max(10000), purchasedQuantity: z.number().int().min(1).max(10000),
  purchaseDate: day, price: z.number().min(0).max(100000).nullable(), shop: z.string().max(200), location: z.string().max(160),
  drinkDate: day, drinkFromYear: drinkYear, drinkUntilYear: drinkYear, bestBefore: day,
  notes: z.string().max(5000), image: link, source: link, untappdUrl: untappdLink.optional(),
  untappdAutoMatch:z.boolean().optional(),untappdCommunityRating:z.number().min(0.1).max(5).nullable().optional(),
  untappdDescription:z.string().trim().max(1200).optional(),
  untappdPage:z.object({key:z.string().max(1600),data:untappdPageSchema}).optional(),
  photo: photo.nullable().optional(), hasPhoto: z.boolean().optional(),
  photoPreference: z.enum(['online','own']).optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime()
}).refine(b => b.quantity <= b.purchasedQuantity, 'Voorraad mag niet groter zijn dan het aangekochte aantal')
  .refine(({drinkFromYear, drinkUntilYear}) => (
    drinkFromYear === undefined && drinkUntilYear === undefined
  ) || (
    drinkFromYear !== undefined && drinkUntilYear !== undefined && drinkFromYear <= drinkUntilYear
  ), 'Vul beide drinkjaren in en zet het eindjaar op of na het beginjaar');
export type Beer = z.infer<typeof beerSchema>;
export const today = () => new Date().toLocaleDateString('en-CA', {timeZone:'Europe/Brussels'});
function newId(): string {
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function emptyBeer(): Beer { const now = new Date().toISOString(); return {id:newId(),name:'',brewery:'',style:'',barcode:'',abv:null,volume:750,vintage:'',quantity:1,purchasedQuantity:1,purchaseDate:today(),price:null,shop:'',location:'',drinkDate:'',bestBefore:'',notes:'',image:'',source:'',createdAt:now,updatedAt:now}; }
