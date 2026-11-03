import { createHandler } from "./handler.mjs";
import { firebaseConfig } from "./firebase-config.mjs";

// A chave administrativa é fornecida pelo ambiente gerenciado do Supabase.
// Ela nunca é enviada ao navegador ou incluída nos arquivos de configuração.
Deno.serve(createHandler({
  ...firebaseConfig,
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
}));
