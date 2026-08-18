export type BlogArticleContentBlock =
  | {
      type: "paragraph";
      content: string;
    }
  | {
      type: "list";
      items: string[];
    }
  | {
      type: "note";
      content: string;
    }
  | {
      type: "table";
      headers: string[];
      rows: string[][];
    };

export type BlogArticleSection = {
  heading: string;
  body: BlogArticleContentBlock[];
};

export type BlogArticleFaq = {
  question: string;
  answer: string;
};

export type BlogArticle = {
  slug: string;
  title: string;
  description: string;
  category: string;
  publishedAt: string;
  readingTime: string;
  keywords: string[];
  intro: string;
  sections: BlogArticleSection[];
  faq?: BlogArticleFaq[];
};
