// trieloff 2023-08-23: checking if this gets deployed

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  const createMetaTag = (name, value) => {
    return `<meta name="${name}" content="${value}">\n`;
}

  const rewriteMeta = async (data) => {
    if (data.status !== 200) return data.body;
    const metadataURL = `https://${ref}--${repo}--${owner}.hlx.${state}/.snapshots/${reviewId}/metadata.json`;
    const metaresp = await fetch(metadataURL, request);
    const metadata = await metaresp.json();
    const html = await data.text();
    const headSplits = html.split('</head>');
    const rules = metadata.data;
    rules.forEach((rule) => {
      const pattern = rule.URL.replaceAll('**', '.*');
      const regex = new RegExp(pattern);
      if (regex.test(url.pathname)) {
        const metanames = Object.keys(rule);
        metanames.forEach((metaname) => {
          const name = metaname.toLowerCase();
          if (name !== 'url' && rule[metaname]) {
            headSplits[0] = headSplits[0].replace(`<meta name="${name}"`, `<meta name="${name}-rewritten"`);
            headSplits[0] = headSplits[0] + createMetaTag(name, rule[metaname]);
          }
        })

      }
    })
    const modBody = headSplits.join('</head>');
    return modBody;
  }

  const createSnapshotRedirect = (pathname) => {
    const location = `/${pathname.split('/').slice(3).join('/')}`;
    return new Response('Redirect', {
      status: 302,
      headers: {
        location,
        "content-type": "text/plain;charset=UTF-8",
      },
    });
  };
  console.log(url.pathname);
  if (url.pathname.startsWith('/.snapshots/')) {
    return createSnapshotRedirect(url.pathname);
  }

  const hostname = url.hostname.endsWith('.hlx.reviews') ? url.hostname : 'default--main--thinktanked--davidnuescheler.hlx.reviews';
  const origin = hostname.split('.')[0];
  const [reviewId, ref, repo, owner] = origin.split('--');
  const adminUrl = `https://reviews-admin.david8603.workers.dev/?hostname=${ref}--${repo}--${owner}.hlx.reviews&ck=${Math.random()}`;
  console.log('adminurl', adminUrl, request.headers.get('accept-encoding'));
  // trieloff 2023-07-07 https://adobe-dx-support.slack.com/archives/C04UABXPYV7/p1688733405484269?thread_ts=1688731874.491589&cid=C04UABXPYV7
  // I've been seeing parsing errors that looked upon closer inspection as if the response from the admin API was compressed
  // so I'm forcing no compression by cloning the request (the orginal request is immutable) and resetting the accept-encoding header
  const newreq = new Request(request);
  newreq.headers.set('accept-encoding', 'identity');
  const resp = await fetch(adminUrl, newreq);
  const json = await resp.json();
  const reviews = json.data;
  const review = reviews.find((e) => e.reviewId === reviewId);
  if (!review) {
    return new Response('Review Not Found', {
      status: 404,
      headers: {
        "content-type": "text/plain;charset=UTF-8",
      },
    });
  }
  const pages = review.pages ? review.pages.split(',').map((e) => e.trim()).map((e) => e.split('?')[0]) : [];
  const createRobots = async () => {
    const robots = `User-agent: *\nAllow: /\n\nSitemap: https://${url.hostname}/sitemap.xml`;

    return new Response(robots, {
      headers: {
        "content-type": "text/plain;charset=UTF-8",
      },
    });
  };

  const createReviewSitemap = async () => {
    const indexedPages = [];
    try {
      const resp = await fetch(`https://${ref}--${repo}--${owner}.hlx.page/query-index.json`, request);
      const json = await resp.json();
      indexedPages.push(...json.data);
    } catch {
      console.log('no index');
    }

    pages.push(...indexedPages.map((e) => e.path));
    const urls = [...new Set(pages.map((path) => `https://${url.hostname}${path}`))];
    console.log(urls);

    const sitemap = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
    ${urls.map((e) => '<url>' + e + '</url>').join('\n')}
    </urlset>`;

    return new Response(sitemap, {
      headers: {
        "content-type": "text/xml;charset=UTF-8",
      },
    });
  };

  if (url.pathname === '/sitemap.xml') return await createReviewSitemap();
  if (url.pathname === '/robots.txt') return createRobots();

  let pathname = url.pathname;

  if (pathname.endsWith('.plain.html')) pathname = pathname.split('.')[0];
  const state = pages.includes(pathname) ? 'page' : 'live';

  url.hostname = `${ref}--${repo}--${owner}.hlx.${state}`;
  if (state === 'page') {
    url.pathname = `/.snapshots/${reviewId}${url.pathname}`;
  }
  const req = new Request(url, request);
  req.headers.set('x-forwarded-host', req.headers.get('host'));

  const data = await fetch(url.toString(), req);
  let body = data.body;
  if (pages.includes('/metadata.json') && !url.pathname.includes('.')) {
    body = await rewriteMeta(data);
  }
  const response = new Response(body, data);
  
  response.headers.set('content-security-policy', '');
  response.headers.set('x-origin-url', url.toString());
  response.headers.set('x-review-pages', review.pages);
  response.headers.set('x-debug', `${pathname}: [${pages.join(',')}]`);
  return response;
}