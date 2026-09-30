import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [{ title: "Terms of Use — Aura" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro="These terms govern your use of the Aura platform. Aura is an Internet Activity Market — it does not grant ownership over any underlying entity."
      updated="September 26, 2026"
      sections={[
        {
          heading: "Activity, not ownership",
          body: "Aura Activity Assets represent measurable internet activity surrounding an entity. They are not company equity, ownership of a person, ownership of a brand, or any claim on the underlying entity.",
        },
        {
          heading: "Markets are speculative",
          body: "Trading activity markets involves substantial risk of loss. Outcomes depend on measured internet behavior, which can be volatile, and no measurement is perfectly immune to manipulation.",
        },
        {
          heading: "Manipulation resistance",
          body: "Aura uses multi-source, cross-validated signals to reduce the impact of bots, spam and coordinated campaigns. Single-source spikes carry reduced confidence. However, Aura does not guarantee that activity is impossible to manipulate.",
        },
        {
          heading: "No investment advice",
          body: "Nothing on Aura constitutes financial, investment or legal advice. Users are solely responsible for their own decisions and should not trade with funds they cannot afford to lose.",
        },
        {
          heading: "Eligibility",
          body: "You must be of legal age in your jurisdiction and may not use Aura where such activity markets are prohibited. You are responsible for complying with all applicable laws.",
        },
      ]}
    />
  );
}
