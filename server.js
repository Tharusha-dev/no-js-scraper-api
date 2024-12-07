import {fastify} from 'fastify';
import got from 'got';
import { parse } from 'node-html-parser';
import Piscina from 'piscina';
import cluster from 'cluster';
import os from 'os';
import emailDomains from './email-domains.json' with { type: "json" };

// const token = '4ihmWf1YOTQiuUWgkD1aaPCF9QOVJfcM'
let activeToken;


const tokenArray = ["4ihmWf1YOTQiuUWgkD1aaPCF9QOVJfcM","YXCXW85Hhk8Rx3VIGujakoWQ3jU3ciir", "afLf5pdLaEMoy32OFztqsGP2G5he11c3"];

const app = fastify();



await app.register(import('@fastify/rate-limit'), {
  max: 25,
  timeWindow: 1000
})

// Create a worker pool for parallel processing - Move this inside the worker condition
const workerPool = cluster.isPrimary ? null : new Piscina({
  filename: new URL('./worker.js', import.meta.url).pathname,  // Move worker code to separate file
  minThreads: 1,
  maxThreads: 6
});

// Configure rate limiting
const rateLimit = {
  max: 25,
  timeWindow: '1000ms'
}

// Configure connection pooling and keepalive
const gotInstance = got.extend(
  
  {
    https: { rejectUnauthorized: false },
    timeout: { request: 65000 },
    retry: {
    limit: 2
  },
  http2: true,

});

app.addHook('preHandler', async (request, reply) => {
  const authHeader = request.headers['auth'];
  if (!authHeader || !tokenArray.includes(authHeader)) {
    activeToken = authHeader;
    reply.status(401).send({
      success: false,
      error: 'Unauthorized. Missing or invalid Auth token.'
    });
  }
});


// Worker function to parse HTML and extract links
async function extractLinks(html, baseUrl) {
  const root = parse(html);
  const links = root.querySelectorAll('a')
    .map(link => {
      const href = link.getAttribute('href');
      if (!href) return null;
      
      try {
        return new URL(href, baseUrl).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  
  return [...new Set(links)]; // Remove duplicates
}

// Add this before the route handler
app.setErrorHandler((error, request, reply) => {
  logger(`${request.method} ${request.url} - ${error.message}`);
  if (error.validation) {
    return {
      success: false,
      status: null,
      scriptTagsPresent: false,
      data: null,
      error: `Validation error: ${error.message}`
    };
  }
  
  // Handle other types of errors
  return {
    success: false,
    status: null,
    scriptTagsPresent: false,
    data: null,
    error: error.message
  };
});

// Main route handler
app.post('/scrape', {

  

  schema: {
    body: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', format: 'uri' },
        userAgent: { type: 'string' },
        proxy: { type: 'string', format: 'uri' }
      }
    }
  }
}, async (request, reply) => {
  try {
    const { url, userAgent, proxy } = request.body;
    logger(`Request received for ${url}`);
    
    // Prepare request options with conditional proxy and userAgent
    const requestOptions = {
      headers: {
        'authority': 'www.google.com',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'max-age=0',
        'cookie': 'SID=ZAjX93QUU1NMI2Ztt_dmL9YRSRW84IvHQwRrSe1lYhIZncwY4QYs0J60X1WvNumDBjmqCA.;',
        'sec-ch-ua': '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
        'sec-ch-ua-arch': '"x86"',
        'sec-ch-ua-bitness': '"64"',
        'sec-ch-ua-full-version': '"115.0.5790.110"',
        'sec-ch-ua-full-version-list': '"Not/A)Brand";v="99.0.0.0", "Google Chrome";v="115.0.5790.110", "Chromium";v="115.0.5790.110"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-model': '""',
        'sec-ch-ua-platform': 'Windows',
        'sec-ch-ua-platform-version': '15.0.0',
        'sec-ch-ua-wow64': '?0',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'x-client-data': '#..',
        'user-agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      },
      responseType: 'text',
      ...(proxy && { proxy: proxy })
    };

    // Fetch HTML with optimized settings and additional options
    const response = await gotInstance(url, requestOptions);



    const extractedData = await workerPool.run({ 
      html: response.body, 
      baseUrl: url,
      headers: response.headers,
      emailDomains
    });
    
    return { 
      success: true,
      status: response.statusCode,
      scriptTagsPresent: extractedData.scriptTagsPresent,
      data: {
        fullHtml: extractedData.fullHtml,
        socialLinks: extractedData.socialLinks,
        emailLinks: extractedData.emailLinks,
        phoneLinks: extractedData.phoneLinks,
        technologies: extractedData.technologies,
        metaTitle: extractedData.metaTitle,
        metaDescription: extractedData.metaDescription,
        metaKeywords: extractedData.metaKeywords
      },
      error: null
    };
    
  } catch (error) {
    logger(`${error}`);
    
    // Get the status code from the error response if available
    const statusCode = error?.response?.statusCode || 403;
    
    // Set the response status code
    reply.code(statusCode);
    
    return { 
      success: false,
      status: statusCode,
      scriptTagsPresent: false,
      data: null,
      error: error.message || 'An unknown error occurred'
    };
  }
});

// Start server
if (cluster.isPrimary) {
  // Fork workers based on CPU cores
  for (let i = 0; i < os.cpus().length; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork(); // Replace dead workers
  });
} else {
  app.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
    if (err) throw err;
    console.log(`Worker ${process.pid} listening on 3000`);
  });
}



function logger(message) {

  const activeSession = {
    "4ihmWf1YOTQiuUWgkD1aaPCF9QOVJfcM" : "1",
    "YXCXW85Hhk8Rx3VIGujakoWQ3jU3ciir" : "2",
    "afLf5pdLaEMoy32OFztqsGP2G5he11c3" : "3"
  }

  console.log(`[${activeSession[activeToken]}] => [${Date.now()}] ${message}`);
}