const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const unknown = () => ({ label: "unknown", tier: "unknown", confidence: 0, method: "factory.insufficient", evidence: [] });

export function labelFromFactoryEpisode(factoryEpisode) {
  try {
    if (!object(factoryEpisode)) return unknown();
    let label;
    let why;
    if (Number(factoryEpisode.rework_attempt) > 0) {
      label = "fail";
      why = "rework proves the first attempt failed";
    } else if (factoryEpisode.terminal_state === "needs-human") {
      label = "fail";
      why = "factory terminated needing human intervention";
    } else if (factoryEpisode.terminal_state === "shipped" && factoryEpisode.tests_ok === true) {
      label = "pass";
      why = "factory shipped with passing tests";
    } else return unknown();

    const unverifiable = factoryEpisode.override_applied !== "none"
      || factoryEpisode.tests_source === "prose"
      || factoryEpisode.review_parse_ok === false;
    if (unverifiable) {
      // In the real factory an unparseable reviewer verdict plus green tests can
      // be byte-identical to genuine approval. Such records are not ground truth.
      return { label, tier: "weak", confidence: 0.4, method: "factory.demoted_unverifiable", evidence: [{ why }] };
    }
    return { label, tier: "gold", confidence: 1, method: "factory.terminal_state", evidence: [{ why }] };
  } catch {
    return unknown();
  }
}
