import type { Beer } from './beer';

type Advice = {
  yearsAfterBottling: readonly [number, number];
  source: string;
  publisher: string;
  explanation: string;
};

const craftBeer = 'https://www.craftbeer.com/wp-content/uploads/2014/10/BeersToAgeAndAgingTimes.pdf';
const rules: ReadonlyArray<Advice & { match: RegExp }> = [
  {
    match: /\bgoudenband\b/i,
    yearsAfterBottling: [0, 10],
    source: 'https://www.liefmans.com/nl-be/craft-blends/goudenband',
    publisher: 'Liefmans',
    explanation: 'Liefmans geeft aan dat Goudenband bij aankoop al drinkklaar is en na tien jaar nog zijn frisse karakter kan hebben.',
  },
  {
    match: /\boude\s+gu?euze\b|\bgu?euze\s+oude stijl\b/i,
    yearsAfterBottling: [3, 10],
    source: 'https://www.huisvandegeuze.be/veelgestelde-vragen/',
    publisher: 'Huis van de Geuze',
    explanation: 'Huis van de Geuze beschrijft hoe oude geuze complexer wordt met de tijd. Dit is een voorstel om gerijpt te proeven. Jong drinken kan ook.',
  },
  {
    match: /\bimperial stout\b/i,
    yearsAfterBottling: [1, 5],
    source: craftBeer,
    publisher: 'CraftBeer.com',
    explanation: 'Stijladvies. CraftBeer.com noemt imperial stout geschikt voor rijping vanaf één jaar. Het voorstel gebruikt een deel van hun brede richtlijn.',
  },
  {
    match: /\bbarley[ -]?wine\b/i,
    yearsAfterBottling: [1, 5],
    source: craftBeer,
    publisher: 'CraftBeer.com',
    explanation: 'Stijladvies. CraftBeer.com noemt voor barleywine minimaal een jaar rijping. Het eindjaar is een gekozen proefmoment.',
  },
];

export function suggestDrinkWindow(beer: Pick<Beer, 'name' | 'brewery' | 'style' | 'vintage' | 'purchaseDate'>) {
  if (!beer.name.trim()) return null;
  const description = `${beer.name} ${beer.brewery} ${beer.style}`;
  const advice = rules.find(rule => rule.match.test(description));
  if (!advice) return null;

  const vintage = beer.vintage.trim();
  const hasBottlingYear = /^(19|20|21)\d{2}$/.test(vintage);
  const baseYear = Number(hasBottlingYear ? vintage : beer.purchaseDate.slice(0, 4));
  if (baseYear < 1900 || baseYear + advice.yearsAfterBottling[1] > 2199 || !Number.isInteger(baseYear)) return null;

  return {
    drinkFromYear: baseYear + advice.yearsAfterBottling[0],
    drinkUntilYear: baseYear + advice.yearsAfterBottling[1],
    source: advice.source,
    publisher: advice.publisher,
    explanation: advice.explanation,
    basis: hasBottlingYear ? `Ingevulde jaargang ${baseYear}.` : `Geschat vanaf aankoopjaar ${baseYear}. Vul de botteljaargang in als je die kent.`,
  };
}

export function drinkStart(beer: Pick<Beer, 'drinkDate' | 'drinkFromYear'>) {
  return beer.drinkFromYear ? `${beer.drinkFromYear}-01-01` : beer.drinkDate;
}
