import { initStudio } from '../apps/local-server/src/init';

// Style packs are Cozy Extensions (ADR 0011): install them from Studio Settings → Styles & workflows.
const result = initStudio();
console.log(JSON.stringify(result, null, 2));
