const articleImages: Record<string, string> = {
  "czy-magazyn-energii-sie-oplaca-w-2026-roku": "/blog/home-storage-evening.png",
  "fotowoltaika-z-magazynem-energii-kiedy-ma-sens": "/blog/home-storage-evening.png",
  "jak-dobrac-magazyn-energii-do-fotowoltaiki": "/blog/storage-sizing-workspace.png",
  "net-billing-a-magazyn-energii-kompletny-poradnik": "/blog/dynamic-energy-pricing.png",
  "ceny-ujemne-energii-co-oznaczaja-dla-wlasciciela-pv": "/blog/dynamic-energy-pricing.png",
  "deye-sungrow-czy-sigenergy": "/blog/storage-systems-comparison.png",
};

export function getBlogArticleImage(slug: string) {
  return articleImages[slug] ?? "/blog/home-storage-evening.png";
}
