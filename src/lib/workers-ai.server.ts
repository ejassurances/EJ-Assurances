const MODELE = "@cf/google/gemma-4-26b-a4b-it";

type FichierDocument = { nom: string; mime: string; base64: string };

type ConversionDocument = {
  name?: string;
  format: "markdown" | "text" | "error";
  data?: string;
  error?: string;
};

type ReponseChat = {
  response?: string;
  choices?: { message?: { content?: string | { text?: string }[] } }[];
};

type WorkersAi = {
  toMarkdown: (
    fichiers: { name: string; blob: Blob }[],
    options?: { conversionOptions?: { output?: { format?: "markdown" | "text" } } },
  ) => Promise<ConversionDocument | ConversionDocument[]>;
  run: (
    modele: string,
    entree: {
      messages: { role: "user"; content: string }[];
      response_format: { type: "json_object" };
      temperature: number;
      max_completion_tokens: number;
      chat_template_kwargs: { enable_thinking: boolean };
    },
  ) => Promise<unknown>;
};

function blobDepuisBase64(base64: string, mime: string): Blob {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets.buffer], { type: mime || "application/octet-stream" });
}

function lireTexteReponse(brut: unknown): string {
  if (typeof brut === "string") return brut;
  const obj = (brut ?? {}) as ReponseChat;
  if (typeof obj.response === "string") return obj.response;
  const contenu = obj.choices?.[0]?.message?.content;
  if (typeof contenu === "string") return contenu;
  if (Array.isArray(contenu)) {
    return contenu.map((part) => part.text ?? "").join("");
  }
  throw new Error("Workers AI n'a pas renvoyé de réponse exploitable.");
}

/** Convertit les documents puis analyse leur contenu avec le binding Cloudflare Workers AI. */
export async function analyserDocumentsAvecWorkersAi(prompt: string, fichiers: FichierDocument[]) {
  let ai: WorkersAi | undefined;
  try {
    const { env } = await import("cloudflare:workers");
    ai = env["AI"] as WorkersAi | undefined;
  } catch {
    throw new Error(
      "Analyse IA indisponible dans cet environnement : utilisez le CRM déployé sur Cloudflare Workers.",
    );
  }

  if (!ai?.toMarkdown || !ai.run) {
    throw new Error(
      "Workers AI n'est pas activé sur ce Worker. Vérifiez le binding AI dans la configuration Cloudflare.",
    );
  }

  const documentsConvertis = await ai.toMarkdown(
    fichiers.map((fichier) => ({
      name: fichier.nom,
      blob: blobDepuisBase64(fichier.base64, fichier.mime),
    })),
    { conversionOptions: { output: { format: "markdown" } } },
  );
  const documents = Array.isArray(documentsConvertis) ? documentsConvertis : [documentsConvertis];
  const textes = documents.map((document, index) => {
    if (document.format === "error" || !document.data?.trim()) {
      throw new Error(
        `Conversion du document impossible (${document.name ?? fichiers[index]?.nom ?? "document"})${document.error ? ` : ${document.error}` : "."}`,
      );
    }
    return `===== DOCUMENT ${index + 1} — ${document.name ?? fichiers[index]?.nom ?? "document"} =====\n${document.data}`;
  });

  const resultat = await ai.run(MODELE, {
    messages: [
      {
        role: "user",
        content: `${prompt}\n\nDocuments contractuels convertis en texte :\n\n${textes.join("\n\n")}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_completion_tokens: 12000,
    chat_template_kwargs: { enable_thinking: false },
  });

  return { modele: MODELE, texte: lireTexteReponse(resultat) };
}
