import { Actor } from 'apify';
import { log } from 'crawlee';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { v4 as uuidv4 } from 'uuid';

import { addPlaywrightCrawlRequest, addSearchRequest, createAndStartCrawlers, getPlaywrightCrawlerKey } from './crawlers.js';
import { UserInputError } from './errors.js';
import { checkInputsAreValid, processInput } from './input.js';
import { addTimeoutToAllResponses, sendResponseError } from './responses.js';
import { Input } from './types.js';
import {
    addTimeMeasureEvent,
    checkForExtraParams,
    createRequest,
    createSearchRequest,
    isValidUrl,
    parseParameters,
    toProperUrl,
} from './utils.js';

await Actor.init();

const ROUTE_SEARCH = '/search';

Actor.on('migrating', () => {
    addTimeoutToAllResponses(60);
});

async function getSearch(request: IncomingMessage, response: ServerResponse) {
    try {
        const requestReceivedTime = Date.now();
        const params = parseParameters(request.url?.slice(ROUTE_SEARCH.length, request.url.length) ?? '');
        log.info(`Received query parameters: ${JSON.stringify(params)}`);
        checkForExtraParams(params);

        // Process the query parameters the same way se normal inputs
        const {
            input,
            cheerioCrawlerOptions,
            playwrightCrawlerOptions,
            playwrightScraperSettings,
        } = await processInput(params as Partial<Input>);

        await checkInputsAreValid(input);

        // playwrightCrawlerKey is used to identify the crawler that should process the search results
        const playwrightCrawlerKey = getPlaywrightCrawlerKey(playwrightCrawlerOptions, playwrightScraperSettings);
        await createAndStartCrawlers(cheerioCrawlerOptions, playwrightCrawlerOptions, playwrightScraperSettings);

        const isUrl = isValidUrl(input.query);
        input.query = isUrl ? toProperUrl(input.query) : input.query;
        // Create the request depending on whether the input is a URL or search query
        const req = isUrl
            ? createRequest({ url: input.query }, uuidv4(), null)
            : createSearchRequest(
                input.query,
                input.maxResults,
                playwrightCrawlerKey,
                cheerioCrawlerOptions.proxyConfiguration,
            );
        addTimeMeasureEvent(req.userData!, 'request-received', requestReceivedTime);
        if (isUrl) {
            // If the input query is a URL, we don't need to run the search crawler
            log.info(`Input: ${input.query} is a URL, skipping search crawler`);
            await addPlaywrightCrawlRequest(req, req.uniqueKey!, playwrightCrawlerKey);
        } else {
            await addSearchRequest(req, response, cheerioCrawlerOptions);
            setTimeout(() => {
                sendResponseError(req.uniqueKey!, 'Timed out');
            }, input.requestTimeoutSecs * 1000);
        }
    } catch (e) {
        const error = e as Error;
        const errorMessage = { errorMessage: error.message };
        const statusCode = error instanceof UserInputError ? 400 : 500;
        log.error(`UserInputError occurred: ${error.message}`);
        response.writeHead(statusCode, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(errorMessage));
    }
}

const server = createServer(async (req, res) => {
    log.info(`Request received: ${req.method} ${req.url}`);

    if (req.url?.startsWith(ROUTE_SEARCH)) {
        if (req.method === 'GET') {
            await getSearch(req, res);
        } else if (req.method === 'HEAD') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end();
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ errorMessage: 'Bad request' }));
        }
    } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify({
                message: 'RAG-Web-Browser is running in standby mode, sent GET request to "/search?query=apify"',
            }),
        );
    }
});

const { input, cheerioCrawlerOptions, playwrightCrawlerOptions, playwrightScraperSettings } = await processInput(
    (await Actor.getInput<Partial<Input>>()) ?? ({} as Input),
);

log.info(`Loaded input: ${JSON.stringify(input)},
    cheerioCrawlerOptions: ${JSON.stringify(cheerioCrawlerOptions)},
    playwrightCrawlerOptions: ${JSON.stringify(playwrightCrawlerOptions)},
    playwrightScraperSettings ${JSON.stringify(playwrightScraperSettings)}
`);

if (Actor.getEnv().metaOrigin === 'STANDBY') {
    log.info('Actor is running in STANDBY mode with default parameters. '
        + 'Changing these parameters on the fly is not supported at the moment.');

    const port = Actor.isAtHome() ? process.env.ACTOR_STANDBY_PORT : 3000;
    server.listen(port, async () => {
        // Pre-create default crawlers
        log.info(`RAG-Web-Browser is listening for user requests`);
        await createAndStartCrawlers(cheerioCrawlerOptions, playwrightCrawlerOptions, playwrightScraperSettings);
    });
} else {
    log.info('Actor is running in the NORMAL mode');
    try {
        const startedTime = Date.now();
        await checkInputsAreValid(input);

        cheerioCrawlerOptions.keepAlive = false;
        playwrightCrawlerOptions.keepAlive = false;

        // playwrightCrawlerKey is used to identify the crawler that should process the search results
        const playwrightCrawlerKey = getPlaywrightCrawlerKey(playwrightCrawlerOptions, playwrightScraperSettings);
        const [searchCrawler, playwrightCrawler] = await createAndStartCrawlers(
            cheerioCrawlerOptions,
            playwrightCrawlerOptions,
            playwrightScraperSettings,
            false,
        );

        const isUrl = isValidUrl(input.query);
        input.query = isUrl ? toProperUrl(input.query) : input.query;
        // Create the request depending on whether the input is a URL or search query
        const req = isUrl
            ? createRequest({ url: input.query }, uuidv4(), null)
            : createSearchRequest(
                input.query,
                input.maxResults,
                playwrightCrawlerKey,
                cheerioCrawlerOptions.proxyConfiguration,
            );
        addTimeMeasureEvent(req.userData!, 'actor-started', startedTime);
        if (isUrl) {
            // If the input query is a URL, we don't need to run the search crawler
            log.info(`Input: ${input.query} is a URL, skipping search crawler`);
            await addPlaywrightCrawlRequest(req, req.uniqueKey!, playwrightCrawlerKey);
        } else {
            await addSearchRequest(req, null, cheerioCrawlerOptions);
            addTimeMeasureEvent(req.userData!, 'before-cheerio-run', startedTime);
            log.info(`Running search crawler with request: ${JSON.stringify(req)}`);
            await searchCrawler!.run();
        }

        addTimeMeasureEvent(req.userData!, 'before-playwright-run', startedTime);
        log.info(`Running content crawler with request: ${JSON.stringify(req)}`);
        await playwrightCrawler!.run();
    } catch (e) {
        const error = e as Error;
        await Actor.fail(error.message as string);
    }
    await Actor.exit();
}
