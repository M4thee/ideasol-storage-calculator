import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://magazyny.ideasol.pl/sitemap.xml",
    host: "https://magazyny.ideasol.pl",
  };
}
