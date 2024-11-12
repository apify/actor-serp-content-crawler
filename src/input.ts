import { Actor } from 'apify';
import { BrowserName, CheerioCrawlerOptions, log, PlaywrightCrawlerOptions } from 'crawlee';
import { firefox } from 'playwright';

import defaults from './defaults.json' with { type: 'json' };
import { UserInputError } from './errors.js';
import type { Input, PlaywrightScraperSettings } from './types.js';

/**
 * Processes the input and returns the settings for the crawler (adapted from: Website Content Crawler).
 */

export async function processInput(originalInput: Partial<Input>) {
    const input: Input = { ...(defaults as unknown as Input), ...originalInput };

    if (input.dynamicContentWaitSecs >= input.requestTimeoutSecs) {
        input.dynamicContentWaitSecs = Math.round(input.requestTimeoutSecs / 2);
    }

    const {
        debugMode,
        dynamicContentWaitSecs,
        initialConcurrency,
        keepAlive,
        minConcurrency,
        maxConcurrency,
        maxRequestRetries,
        serpMaxRetries,
        outputFormats,
        proxyConfiguration,
        serpProxyGroup,
        readableTextCharThreshold,
        removeCookieWarnings,
    } = input;

    log.setLevel(debugMode ? log.LEVELS.DEBUG : log.LEVELS.INFO);

    const proxySearch = await Actor.createProxyConfiguration({ groups: [serpProxyGroup] });
    const cheerioCrawlerOptions: CheerioCrawlerOptions = {
        keepAlive,
        maxRequestRetries: serpMaxRetries,
        proxyConfiguration: proxySearch,
        autoscaledPoolOptions: { desiredConcurrency: 1 },
    };
    const proxy = await Actor.createProxyConfiguration(proxyConfiguration);
    const playwrightCrawlerOptions: PlaywrightCrawlerOptions = {
        headless: true,
        keepAlive,
        maxRequestRetries,
        proxyConfiguration: proxy,
        requestHandlerTimeoutSecs: input.requestTimeoutSecs,
        launchContext: {
            launcher: firefox,
        },
        browserPoolOptions: {
            fingerprintOptions: {
                fingerprintGeneratorOptions: {
                    browsers: [BrowserName.firefox],
                },
            },
            retireInactiveBrowserAfterSecs: 60,
        },
        autoscaledPoolOptions: {
            desiredConcurrency: initialConcurrency === 0 ? undefined : Math.min(initialConcurrency, maxConcurrency),
            maxConcurrency,
            minConcurrency,
        },
    };

    const playwrightScraperSettings: PlaywrightScraperSettings = {
        debugMode,
        dynamicContentWaitSecs,
        maxHtmlCharsToProcess: 1.5e6,
        outputFormats,
        readableTextCharThreshold,
        removeCookieWarnings,
    };

    return { input, cheerioCrawlerOptions, playwrightCrawlerOptions, playwrightScraperSettings };
}

export async function checkInputsAreValid(input: Partial<Input>) {
    if (!input.query) {
        throw new UserInputError('The "query" parameter must be provided and non-empty');
    }
    if (input.maxResults !== undefined && input.maxResults <= 0) {
        throw new UserInputError('The "maxResults" parameter must be greater than 0');
    }
}
