import { parse } from 'node-html-parser';
import { scanForTechnologies } from './test.js';
// import emailDomains from './email-domains.json';

// Pre-compile social pattern regex
const SOCIAL_PATTERNS = /facebook|twitter|linkedin|instagram|youtube|pinterest|tiktok|github|medium/i;

// Helper function to extract domain from URL or email
function getDomain(str) {
  return str.split('@').pop().toLowerCase();
}

export default async function ({ html, baseUrl, headers, emailDomains }) {
  const root = parse(html);
  
  // Get the base domain for comparison, taking only the last two parts
  // console.log(new URL(baseUrl).hostname.toLowerCase());
  let baseDomain = new URL(baseUrl).hostname.toLowerCase().split('.').slice(-2).join('.');
  // console.log(baseDomain);  

 

  // console.log(emailDomains.length, emailDomains[5]);
  // console.log(baseDomain);
  
  // Create a Set of allowed domains for faster lookup
  const allowedDomains = new Set([...emailDomains, baseDomain]);
  
  const technologies = await scanForTechnologies(root, headers);
  // Check for script tags in head
  const scriptTagsPresent = root.querySelector('head')?.querySelectorAll('script').length > 0;
  
  // Extract different types of links
  const allLinks = root.querySelectorAll('a');
  // console.log(allLinks);
  
  const processedLinks = allLinks.reduce((acc, link) => {
    const href = link.getAttribute('href');
    // console.log(href);
    if (!href) return acc;
    
    if (href.startsWith('mailto:')) {
      const email = href.replace('mailto:', '');
      // console.log(email);
      const emailDomain = getDomain(email);
      if (allowedDomains.has(emailDomain)) {
        acc.emailLinks.push(email);
      }
      return acc;
    }
    if (href.startsWith('tel:')) {
      acc.phoneLinks.push(href.replace('tel:', ''));
      return acc;
    }
    
    try {
      const fullUrl = new URL(href, baseUrl).href;
      if (SOCIAL_PATTERNS.test(fullUrl)) {
        acc.socialLinks.push(fullUrl);
      }
    } catch {
      // Invalid URL - ignore
    }
    return acc;
  }, {
    socialLinks: [],
    emailLinks: [],
    phoneLinks: []
  });

  // console.log(processedLinks.emailLinks);
  
  // Extract meta information
  const metaTitle = root.querySelector('title')?.text || '';
  const metaDescription = root.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const metaKeywords = root.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
  
  return {
    ...processedLinks,
    scriptTagsPresent,
    fullHtml: html,
    socialLinks: processedLinks.socialLinks,
    emailLinks: processedLinks.emailLinks,
    phoneLinks: processedLinks.phoneLinks,
    technologies,
    metaTitle,
    metaDescription,
    metaKeywords
  };
}