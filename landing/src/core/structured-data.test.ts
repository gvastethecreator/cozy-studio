import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { landingStructuredData } from './structured-data';

const view = load(readFileSync(path.resolve(import.meta.dirname, '../..', 'site.yaml'), 'utf8')) as
  Required<Omit<Parameters<typeof landingStructuredData>[0], 'pageTitle'>>;
const input = {
  project: view.project,
  pageTitle: view.project.name,
  sections: view.sections,
  faq: view.faq,
};

describe('landing structured data', () => {
  it('links the real app, website, page and visible FAQ without invented reviews', () => {
    const graph = JSON.parse(landingStructuredData(input))['@graph'];
    const app = graph.find((node: Record<string, unknown>) => node['@type'] === 'SoftwareApplication');
    const page = graph.find((node: Record<string, unknown>) => node['@type'] === 'WebPage');
    const faq = graph.find((node: Record<string, unknown>) => node['@type'] === 'FAQPage');
    expect(new Set(graph.map((node: Record<string, unknown>) => node['@id'])).size).toBe(graph.length);
    expect(app).toMatchObject({
      name: view.project.name,
      description: view.project.description,
      isAccessibleForFree: true,
      offers: { price: 0, priceCurrency: 'USD' },
      mainEntityOfPage: { '@id': page['@id'] },
    });
    expect(app).not.toHaveProperty('aggregateRating');
    expect(app).not.toHaveProperty('review');
    expect(page.mainEntity).toEqual({ '@id': app['@id'] });
    expect(faq.mainEntity.map((question: { name: string; acceptedAnswer: { text: string } }) => ({
      question: question.name,
      answer: question.acceptedAnswer.text,
    }))).toEqual(view.faq.items.map(({ question, answer }: { question: string; answer: string }) => ({ question, answer })));
  });

  it('omits a disabled FAQ and keeps authored HTML from terminating the JSON-LD script', () => {
    const encoded = landingStructuredData({
      ...input,
      sections: [],
      project: { ...input.project, name: '</script><script>alert(1)</script>' },
    });
    expect(encoded).not.toContain('</script>');
    const graph = JSON.parse(encoded)['@graph'];
    expect(graph.some((node: Record<string, unknown>) => node['@type'] === 'FAQPage')).toBe(false);
    expect(graph.find((node: Record<string, unknown>) => node['@type'] === 'SoftwareApplication').name).toBe('</script><script>alert(1)</script>');
  });
});
