interface LandingView {
  project: {
    name: string;
    description: string;
    url: string;
    repo: string;
    ogImage?: string;
  };
  pageTitle: string;
  sections: string[];
  faq?: { items: { question: string; answer: string }[] };
}

export function landingStructuredData(view: LandingView) {
  const { project } = view;
  const url = new URL(project.url).href;
  const website = { '@id': `${url}#website` };
  const page = { '@id': `${url}#webpage` };
  const app = { '@id': `${url}#app` };
  const faqItems = view.sections.includes('faq') ? (view.faq?.items ?? []) : [];
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'WebSite',
      ...website,
      url,
      name: project.name,
      description: project.description,
      inLanguage: 'en',
    },
    {
      '@type': 'WebPage',
      ...page,
      url,
      name: view.pageTitle,
      description: project.description,
      inLanguage: 'en',
      isPartOf: website,
      mainEntity: app,
      ...(faqItems.length ? { hasPart: { '@id': `${url}#faq` } } : {}),
    },
    {
      '@type': 'SoftwareApplication',
      ...app,
      name: project.name,
      description: project.description,
      url,
      sameAs: project.repo,
      applicationCategory: 'DesignApplication',
      operatingSystem: ['Windows', 'macOS', 'Linux (best effort)'],
      softwareRequirements: 'Git, Bun and a browser. Image generation requires a supported provider account.',
      installUrl: `${url}#setup`,
      license: `${project.repo}/blob/main/LICENSE`,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', url: `${url}#setup` },
      ...(project.ogImage ? { image: new URL(project.ogImage, url).href } : {}),
      mainEntityOfPage: page,
    },
  ];
  if (faqItems.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      url: `${url}#faq`,
      isPartOf: page,
      about: app,
      mainEntity: faqItems.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c');
}
