import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { blogArticles, getBlogArticleBySlug } from "@/lib/blog/index";
import { getBlogArticleImage } from "@/lib/blog/images";

type Props = { params: Promise<{ slug: string }> };

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(date));
}

function categoryLabel(category: string) {
  return category === "pv-storage" ? "Fotowoltaika + magazyn" : category;
}

export function generateStaticParams() {
  return blogArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: Props) {
  const article = getBlogArticleBySlug((await params).slug);
  if (!article) return { title: "Artykuł nie znaleziony | IdeaSol" };
  const image = getBlogArticleImage(article.slug);
  return {
    title: `${article.title} | IdeaSol`,
    description: article.description,
    keywords: article.keywords,
    alternates: { canonical: `https://magazyny.ideasol.pl/blog/${article.slug}` },
    openGraph: {
      title: `${article.title} | IdeaSol`, description: article.description,
      url: `https://magazyny.ideasol.pl/blog/${article.slug}`,
      siteName: "IdeaSol", locale: "pl_PL", type: "article", publishedTime: article.publishedAt,
      images: [{ url: image, width: 1536, height: 1024, alt: article.title }],
    },
    twitter: { card: "summary_large_image", title: article.title, description: article.description, images: [image] },
  };
}

export default async function BlogArticlePage({ params }: Props) {
  const article = getBlogArticleBySlug((await params).slug);
  if (!article) notFound();
  const articleImage = getBlogArticleImage(article.slug);
  const articleSchema = {
    "@context": "https://schema.org", "@type": "Article", headline: article.title,
    description: article.description, image: `https://magazyny.ideasol.pl${articleImage}`,
    datePublished: article.publishedAt, author: { "@type": "Organization", name: "IdeaSol" },
    publisher: { "@type": "Organization", name: "IdeaSol" },
    mainEntityOfPage: `https://magazyny.ideasol.pl/blog/${article.slug}`,
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Strona główna", item: "https://magazyny.ideasol.pl" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://magazyny.ideasol.pl/blog" },
      { "@type": "ListItem", position: 3, name: article.title, item: `https://magazyny.ideasol.pl/blog/${article.slug}` },
    ],
  };
  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: (article.faq ?? []).map((item) => ({
      "@type": "Question", name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <main className="min-h-screen bg-[#f4f5ef] text-[#13231d]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      {(article.faq?.length ?? 0) > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />}

      <header className="border-b border-[#13231d]/10 bg-[#f4f5ef]/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5">
          <Link href="/blog" className="flex items-center gap-3" aria-label="IdeaSol — baza wiedzy">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#10261f]">
              <Image src="/logo.png" alt="" width={34} height={34} className="h-8 w-8 object-contain" priority />
            </span>
            <span><span className="block text-lg font-black tracking-[-0.03em]">IdeaSol</span><span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#52645d]">Baza wiedzy</span></span>
          </Link>
          <Link href="/#analiza" className="rounded-full bg-[#c7f36b] px-5 py-3 text-sm font-black text-[#10261f] transition hover:-translate-y-0.5">Sprawdź swój dom</Link>
        </div>
      </header>

      <article>
        <header className="px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-12 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <nav className="flex items-center gap-2 text-xs font-bold text-[#78847f]" aria-label="Okruszki">
              <Link href="/">Strona główna</Link><span>/</span><Link href="/blog">Baza wiedzy</Link><span>/</span><span className="truncate">{article.title}</span>
            </nav>
            <div className="mt-9 grid gap-9 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
              <div className="py-3">
                <div className="flex flex-wrap items-center gap-3 text-xs font-black uppercase tracking-[0.12em] text-[#617069]">
                  <span className="rounded-full bg-[#dff3d5] px-3 py-2 text-[#397f72]">{categoryLabel(article.category)}</span>
                  <span>{formatDate(article.publishedAt)}</span><span>•</span><span>{article.readingTime} czytania</span>
                </div>
                <h1 className="mt-6 text-4xl font-black leading-[1.02] tracking-[-0.05em] sm:text-5xl lg:text-6xl">{article.title}</h1>
                <p className="mt-6 max-w-3xl text-lg leading-8 text-[#52645d]">{article.intro}</p>
                <div className="mt-7 flex items-center gap-3 border-t border-[#13231d]/10 pt-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#10261f] text-sm font-black text-[#c7f36b]">IS</span>
                  <div><p className="text-sm font-black">Zespół IdeaSol</p><p className="text-xs text-[#738079]">Analizy energetyczne bez marketingowego dymu</p></div>
                </div>
              </div>
              <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] bg-[#dce4dc] shadow-[0_30px_80px_rgba(16,38,31,0.16)]">
                <Image src={articleImage} alt={article.title} fill priority sizes="(min-width: 1024px) 52vw, 100vw" className="object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#10261f]/75 to-transparent p-6 pt-20 text-sm font-semibold text-white/85">Praktyczny przewodnik • konkrety, scenariusze i liczby</div>
              </div>
            </div>
          </div>
        </header>

        <div className="border-y border-[#13231d]/10 bg-white/45 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-3 sm:grid-cols-3">
            {["Bez ukrytych założeń", "Scenariusze zamiast obietnic", "Wnioski do zastosowania"].map((item, i) => (
              <div key={item} className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#c7f36b] text-xs font-black">0{i + 1}</span><span className="text-sm font-black">{item}</span></div>
            ))}
          </div>
        </div>

        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,780px)_300px] lg:justify-between lg:px-8">
          <div className="min-w-0">
            <div className="space-y-16">
              {article.sections.map((section, sectionIndex) => (
                <section id={`sekcja-${sectionIndex + 1}`} key={section.heading} className="scroll-mt-8">
                  <div className="flex items-start gap-4 sm:gap-6">
                    <span className="mt-1 text-4xl font-black leading-none tracking-[-0.06em] text-[#b5c4bb] sm:text-5xl">{String(sectionIndex + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-3xl font-black leading-[1.08] tracking-[-0.04em] sm:text-4xl">{section.heading}</h2>
                      <div className="mt-7 space-y-6 text-[1.05rem] leading-8 text-[#40534b] sm:text-lg sm:leading-9">
                        {section.body.map((block, index) => {
                          if (block.type === "paragraph") return <p key={index}>{block.content}</p>;
                          if (block.type === "list") return (
                            <ul key={index} className="space-y-3 rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-[#13231d]/8">
                              {block.items.map((item) => <li key={item} className="flex gap-3"><span className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#c7f36b] text-[10px] font-black">✓</span><span>{item}</span></li>)}
                            </ul>
                          );
                          if (block.type === "note") return (
                            <aside key={index} className="rounded-3xl bg-[#10261f] p-7 text-white shadow-xl">
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#c7f36b]">Warto zapamiętać</p><p className="mt-3 text-lg leading-8 text-white/82">{block.content}</p>
                            </aside>
                          );
                          if (block.type === "table") return (
                            <div key={index} className="overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-[#13231d]/8">
                              <table className="min-w-full text-left text-sm"><thead className="bg-[#10261f] text-white"><tr>{block.headers.map((h) => <th key={h} className="px-5 py-4 font-black">{h}</th>)}</tr></thead>
                              <tbody>{block.rows.map((row, ri) => <tr key={ri} className="border-t border-[#13231d]/8 odd:bg-[#f8f9f5]">{row.map((cell, ci) => <td key={ci} className="px-5 py-4 align-top leading-6">{cell}</td>)}</tr>)}</tbody></table>
                            </div>
                          );
                          return null;
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>

            {article.faq && article.faq.length > 0 && (
              <section className="mt-20 border-t border-[#13231d]/12 pt-12">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#397f72]">FAQ</p><h2 className="mt-3 text-4xl font-black tracking-[-0.04em]">Najczęstsze pytania</h2>
                <div className="mt-8 divide-y divide-[#13231d]/10 rounded-3xl bg-white/65 px-6 ring-1 ring-[#13231d]/8">
                  {article.faq.map((item) => <details key={item.question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-black">{item.question}<span className="text-2xl font-light text-[#397f72] transition group-open:rotate-45">+</span></summary><p className="max-w-2xl pb-2 pt-4 leading-7 text-[#52645d]">{item.answer}</p></details>)}
                </div>
              </section>
            )}

            <section className="mt-16 rounded-[2rem] bg-[#dff3d5] p-7 sm:p-9">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[#397f72]">Sprawdź swój scenariusz</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl">Artykuł daje kontekst. Kalkulator daje odpowiedź dla Twojego domu.</h2>
              <p className="mt-4 leading-7 text-[#52645d]">Wprowadź rachunek, taryfę i parametry instalacji. Najpierw zobaczysz prostą rekomendację TAK lub NIE.</p>
              <Link href="/#analiza" className="mt-7 inline-flex rounded-full bg-[#10261f] px-6 py-4 text-sm font-black text-white">Uruchom kalkulator →</Link>
            </section>
          </div>

          <aside className="hidden lg:block"><div className="sticky top-8 space-y-5">
            <div className="rounded-3xl bg-white/70 p-6 ring-1 ring-[#13231d]/8"><p className="text-xs font-black uppercase tracking-[0.18em] text-[#397f72]">W artykule</p><nav className="mt-5 space-y-3 text-sm font-bold text-[#617069]">{article.sections.map((section, i) => <a key={section.heading} href={`#sekcja-${i + 1}`} className="flex gap-3 leading-5 hover:text-[#397f72]"><span className="text-[#a0ada6]">{String(i + 1).padStart(2, "0")}</span><span>{section.heading}</span></a>)}</nav></div>
            <div className="rounded-3xl bg-[#10261f] p-6 text-white"><p className="text-xs font-black uppercase tracking-[0.18em] text-[#c7f36b]">60 sekund</p><h3 className="mt-3 text-xl font-black">Czy magazyn ma sens u Ciebie?</h3><p className="mt-3 text-sm leading-6 text-white/65">Sprawdź bezpłatnie, zanim poprosisz o ofertę.</p><Link href="/#analiza" className="mt-5 inline-flex w-full justify-center rounded-full bg-[#c7f36b] px-5 py-3 text-sm font-black text-[#10261f]">Sprawdź teraz</Link></div>
          </div></aside>
        </div>
      </article>
    </main>
  );
}
