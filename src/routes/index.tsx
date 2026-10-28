import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EJ Assurances — CRM" },
      { name: "description", content: "Espace de gestion EJ Assurances." },
      { property: "og:title", content: "EJ Assurances — CRM" },
      { property: "og:description", content: "Espace de gestion EJ Assurances." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/espace" });
  },
  component: () => null,
});
