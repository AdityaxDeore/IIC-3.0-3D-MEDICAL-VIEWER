import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
const path=(relative:string)=>fileURLToPath(new URL(relative,import.meta.url));
// `root` is ./web, but the .env lives at the repo root — point Vite's env dir there
// so import.meta.env.VITE_* (e.g. VITE_GEMINI_API_KEY) is actually populated.
export default defineConfig({root:path('./web'),envDir:path('./'),publicDir:path('./public'),plugins:[react()],resolve:{alias:{'@':path('./')}},css:{postcss:{plugins:[tailwindcss()]}},server:{watch:{usePolling:true},proxy:{'/api/vista':{target:'http://localhost:8788',changeOrigin:true},'/files':{target:'http://localhost:8788',changeOrigin:true}}},build:{outDir:path('./dist'),emptyOutDir:true}});
