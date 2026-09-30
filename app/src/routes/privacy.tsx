import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Privacy Policy — Aura" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="Aura is designed to measure public internet activity. This policy explains how we handle the limited information we collect."
      updated="September 26, 2026"
      sections={[
        {
          heading: "Public activity data",
          body: "Aura primarily processes public, aggregated internet activity signals — social volume, search interest, media coverage and community activity. We do not read your private messages or personal accounts.",
        },
        {
          heading: "Account information",
          body: "When you connect a wallet or passkey, we may store a public address or identifier to associate your positions and portfolio. We do not collect private keys.",
        },
        {
          heading: "Analytics",
          body: "We may collect anonymous, aggregated usage analytics to improve the product. This data does not identify you personally and is not sold to third parties.",
        },
        {
          heading: "Cookies & storage",
          body: "We use local storage to remember preferences such as your theme choice. You can clear this storage at any time through your browser.",
        },
        {
          heading: "Contact",
          body: "Questions about privacy can be directed to hello@aura.market.",
        },
      ]}
    />
  );
}
