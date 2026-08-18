import Image from "next/image";
import Link from "next/link";
import { blogArticles } from "@/lib/blog/index";
import { getBlogArticleImage } from "@/lib/blog/images";

export const metadata = {
  title: "Baza wiedzy o fotowoltaice i magazynach energii | IdeaSol",
  description:
    "Praktyczne poradniki o magazynach energii, fotowoltaice, net-billingu, taryfach dynamicznych, autokonsumpcji, HEMS/EMS i zasilaniu awaryjnym.",
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(date));
}

function categoryLabel(category: string) {
  if (category === "pv-storage") return "Fotowoltaika + magazyn";
  return category;
}

export default function BlogPage() {
  const sortedArticles = [...blogArticles].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  const featuredArticle = sortedArticles[0];
  const remainingArticles = sortedArticles.slice(1);

  return (
    <main className="min-h-screen bg-[#f4f5ef] text-[#13231d]">
      <header className="border-b border-[#13231d]/10 bg-[#f4f5ef]/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5">
          <Link href="/" className="flex items-center gap-3" aria-label="IdeaSol — strona główna">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#10261f] shadow-sm">
              <Image src="/logo.png" alt="" width={34} height={34} className="h-8 w-8 object-contain" priority />
            </span>
            <span>
              <span className="block text-lg font-black tracking-[-0.03em]">IdeaSol</span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#52645d]">Baza wiedzy</span>
            </span>
          </Link>
          <Link
            href="/#analiza"
            className="rounded-full bg-[#c7f36b] px-5 py-3 text-sm font-black text-[#10261f] transition hover:-translate-y-0.5 hover:bg-[#b9ed54]"
          >
            Sprawdź swój dom
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden px-4 pb-10 pt-14 sm:px-6 sm:pb-16 sm:pt-20 lg:px-8">
        <div className="pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-[#c7f36b]/25 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-[#8edbd2]/20 blur-3xl" />
        <div className="relative mx-auto max-w-7xl">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#397f72]">Energia po ludzku</p>
          <div className="mt-5 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <h1 className="max-w-4xl text-5xl font-black leading-[0.94] tracking-[-0.055em] sm:text-6xl lg:text-8xl">
              Wiedza, która pomaga podjąć <span className="text-[#397f72]">dobrą decyzję.</span>
            </h1>
            <div className="border-l-2 border-[#397f72]/30 pl-6">
              <p className="max-w-xl text-base leading-7 text-[#52645d] sm:text-lg">
                Bez obietnic bez pokrycia. Wyjaśniamy ceny, technologię i opłacalność tak, żeby przed rozmową ze sprzedawcą znać właściwe pytania.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-[#30463e]">
                <span className="rounded-full border border-[#13231d]/10 bg-white/60 px-3 py-2">Obliczenia</span>
                <span className="rounded-full border border-[#13231d]/10 bg-white/60 px-3 py-2">Technologie</span>
                <span className="rounded-full border border-[#13231d]/10 bg-white/60 px-3 py-2">Net-billing</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {featuredArticle ? (
            <Link
              href={`/blog/${featuredArticle.slug}`}
              className="group grid overflow-hidden rounded-[2rem] bg-[#10261f] text-white shadow-[0_30px_80px_rgba(16,38,31,0.18)] lg:grid-cols-[1.15fr_0.85fr]"
            >
              <div className="relative min-h-[340px] overflow-hidden sm:min-h-[460px]">
                <Image
                  src={getBlogArticleImage(featuredArticle.slug)}
                  alt={featuredArticle.title}
                  fill
                  sizes="(min-width: 1024px) 58vw, 100vw"
                  className="object-cover transition duration-700 group-hover:scale-[1.025]"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#10261f]/75 via-transparent to-transparent lg:bg-gradient-to-r lg:from-transparent lg:to-[#10261f]/20" />
                <span className="absolute left-6 top-6 rounded-full bg-[#c7f36b] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-[#10261f]">
                  Wyróżniony temat
                </span>
              </div>
              <div className="flex flex-col justify-center p-7 sm:p-10 lg:p-12">
                <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-white/55">
                  <span className="text-[#9ee5d9]">{categoryLabel(featuredArticle.category)}</span>
                  <span>•</span>
                  <span>{featuredArticle.readingTime} czytania</span>
                </div>
                <h2 className="mt-6 text-3xl font-black leading-[1.08] tracking-[-0.035em] sm:text-4xl">
                  {featuredArticle.title}
                </h2>
                <p className="mt-5 line-clamp-4 text-base leading-7 text-white/68">
                  {featuredArticle.description}
                </p>
                <div className="mt-8 flex items-center gap-3 text-sm font-black text-[#c7f36b]">
                  Przeczytaj analizę <span className="text-xl transition group-hover:translate-x-1">→</span>
                </div>
              </div>
            </Link>
          ) : null}

          {remainingArticles.length > 0 && (
            <div className="mt-16">
              <div className="flex items-end justify-between gap-6 border-b border-[#13231d]/12 pb-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-[#397f72]">Najnowsze publikacje</p>
                  <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] sm:text-4xl">Czytaj dalej</h2>
                </div>
                <p className="hidden text-sm font-semibold text-[#6b7974] sm:block">{sortedArticles.length} artykułów</p>
              </div>

              <div className="mt-8 grid gap-x-6 gap-y-10 md:grid-cols-2 xl:grid-cols-3">
                {remainingArticles.map((article) => (
                  <Link key={article.slug} href={`/blog/${article.slug}`} className="group">
                    <div className="relative aspect-[16/10] overflow-hidden rounded-[1.5rem] bg-[#dce4dc]">
                      <Image
                        src={getBlogArticleImage(article.slug)}
                        alt=""
                        fill
                        sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                        className="object-cover transition duration-500 group-hover:scale-[1.035]"
                      />
                      <span className="absolute left-4 top-4 rounded-full bg-[#f4f5ef]/90 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#10261f] backdrop-blur">
                        {categoryLabel(article.category)}
                      </span>
                    </div>
                    <div className="px-1 pt-5">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#738079]">
                        <span>{formatDate(article.publishedAt)}</span><span>•</span><span>{article.readingTime}</span>
                      </div>
                      <h3 className="mt-3 text-2xl font-black leading-[1.12] tracking-[-0.025em] text-[#13231d] transition group-hover:text-[#397f72]">
                        {article.title}
                      </h3>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#617069]">{article.description}</p>
                      <div className="mt-4 text-sm font-black text-[#397f72]">Czytaj artykuł →</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <section className="mt-20 overflow-hidden rounded-[2rem] bg-[#dff3d5] p-7 sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-12">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[#397f72]">Liczby dla Twojego domu</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-black tracking-[-0.04em] sm:text-4xl">Teoria to początek. Sprawdź własny scenariusz.</h2>
              <p className="mt-4 max-w-2xl leading-7 text-[#52645d]">Krótka analiza odpowie, czy magazyn ma sens — zanim zobaczysz cenę i porozmawiasz z doradcą.</p>
            </div>
            <Link href="/#analiza" className="mt-7 inline-flex shrink-0 rounded-full bg-[#10261f] px-6 py-4 text-sm font-black text-white transition hover:-translate-y-0.5 lg:mt-0">
              Uruchom kalkulator →
            </Link>
          </section>
        </div>
      </section>
    </main>
  );
}
