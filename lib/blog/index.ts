export type {
  BlogArticle,
  BlogArticleContentBlock,
  BlogArticleFaq,
  BlogArticleSection,
} from "./types";

import { cenyUjemneEnergiiCoOznaczajaDlaWlascicielaPv } from "./articles/ceny-ujemne-energii-co-oznaczaja-dla-wlasciciela-pv";
import { deyeSungrowCzySigenergyArticle } from "./articles/deye-sungrow-czy-sigenergy";
import { jakDobracMagazynEnergiiDoFotowoltaikiArticle } from "./articles/jak-dobrac-magazyn-energii-do-fotowoltaiki";
import netBillingAMagazynEnergiiKompletnyPoradnikArticle from "./articles/net-billing-a-magazyn-energii-kompletny-poradnik";

import { blogArticles as legacyBlogArticles } from "../blog";

export const blogArticles = [
  ...legacyBlogArticles.filter(
    (article) =>
      article.slug !== "ceny-ujemne-energii-co-oznaczaja-dla-wlasciciela-pv" &&
      article.slug !== "deye-sungrow-czy-sigenergy" &&
      article.slug !== "jak-dobrac-magazyn-energii-do-fotowoltaiki" &&
      article.slug !== "net-billing-a-magazyn-energii-kompletny-poradnik"
  ),
  deyeSungrowCzySigenergyArticle,
  jakDobracMagazynEnergiiDoFotowoltaikiArticle,
  netBillingAMagazynEnergiiKompletnyPoradnikArticle,
  cenyUjemneEnergiiCoOznaczajaDlaWlascicielaPv,
];

export function getBlogArticleBySlug(slug: string) {
  return blogArticles.find((article) => article.slug === slug) ?? null;
}

export function getFeaturedBlogArticles(limit = 4) {
  return blogArticles.slice(0, limit);
}
