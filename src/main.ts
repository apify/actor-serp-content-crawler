import { Actor } from 'apify';
import type { CheerioAPI } from 'cheerio';
import {
    CheerioCrawler,
    CheerioCrawlingContext,
    PlaywrightCrawler,
    log,
    PlaywrightCrawlingContext,
    PlaywrightCrawlerOptions,
} from 'crawlee';
import { scrapeOrganicResults } from './google-extractors-urls.js';
import { genericHandler } from './request-handler';
import { UserData } from './types.js';
import { processInput } from './input.js';

await Actor.init();

try {
    let searchUrls: string[] = [];
    log.setLevel(log.LEVELS.INFO);

    interface Input {
        queries: string;
        resultsPerPage: number;
    }

    const proxyConfiguration = await Actor.createProxyConfiguration({
        // groups: ['GOOGLE_SERP'],
    });

    const processedInput = await processInput((await Actor.getInput<Partial<Input>>()) ?? ({} as Input));

    /**
     * Create a CheerioCrawler to scrape organic search results from Google.
     */
    const crawler = new CheerioCrawler({
        proxyConfiguration,
        requestHandler: async ({ request, $: _$ }: CheerioCrawlingContext<UserData>) => {
            // NOTE: we need to cast this to fix `cheerio` type errors
            const $ = _$ as CheerioAPI;

            log.info(`Processing organic search results: ${request.url}`);
            const organicResults = scrapeOrganicResults($);

            searchUrls = organicResults.map((result) => result.url).filter((url): url is string => url !== undefined);
            log.info(`Extracted URLs: ${searchUrls.join('\n')}, \nlength: ${searchUrls.length}`);
        },
    });

    // increase the number of search results to be sure we get enough results as there are some duplicates
    const maxSearchResults = processedInput.input.maxResults + 5;

    const url = `https://www.google.com/search?q=${processedInput.input.queries}&num=${maxSearchResults}`;
    await crawler.run([url]);

    const crawlerOptions: PlaywrightCrawlerOptions = {
        ...(processedInput.crawlerOptions as PlaywrightCrawlerOptions),
        headless: true,
        minConcurrency: Math.min(searchUrls.length, processedInput.input.minConcurrency),
        maxConcurrency: Math.min(searchUrls.length, processedInput.input.maxConcurrency),
    };

    const crawlerContent = new PlaywrightCrawler({
        requestHandler: (context: PlaywrightCrawlingContext) => genericHandler(context, processedInput.scraperSettings),
        ...crawlerOptions,
    });
    await crawlerContent.run(searchUrls);
} catch (e) {
    await Actor.fail((e as Error).message);
}

await Actor.exit();
