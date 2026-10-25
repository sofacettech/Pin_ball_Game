// Indian-Cities-JSON by Nishant Arora (MIT).
// https://github.com/nshntarora/Indian-Cities-JSON
// Snapshot retrieved 2026-10-25; license: licenses/indian-cities-MIT.txt.
import indianCities from './india-cities.json' with {type:'json'};
const normalise=value=>value.trim().normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en-IN');
export function matchingIndianCities(query=''){
 const search=normalise(query);
 return search?indianCities.filter(city=>normalise(city.name).includes(search)):indianCities;
}
