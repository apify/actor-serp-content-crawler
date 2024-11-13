import { Actor } from 'apify';
import { BrowserName, CheerioCrawlerOptions, log, PlaywrightCrawlerOptions } from 'crawlee';
import { firefox } from 'playwright';

import { defaults } from './const.js';
import { UserInputError } from './errors.js';
import type { Input, PlaywrightScraperSettings, OutputFormats } from './types.js';

/**
 * Processes the input and returns the settings for the crawler (adapted from: Website Content Crawler).
 */

export async function processInput(originalInput: Partial<Input>) {
    const input = { ...defaults, ...originalInput } as Input;

    validateAndFillInput(input);

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

export function validateAndFillInput(input: Input) {
    const validateRange = (
        value: number | undefined,
        min: number,
        max: number,
        defaultValue: number,
        fieldName: string,
    ) => {
        if (value === undefined || value < min) {
            log.warning(`The "${fieldName}" parameter must be at least ${min}. Using default value ${defaultValue}.`);
            return defaultValue;
        } if (value > max) {
            log.warning(`The "${fieldName}" parameter is limited to ${max}. Using default max value ${max}.`);
            return max;
        }
        return value;
    };
    if (!input.query) {
        throw new UserInputError('The "query" parameter must be provided and non-empty');
    }

    input.maxResults = validateRange(input.maxResults, 1, defaults.maxResultsMax, defaults.maxResults, 'maxResults');
    input.requestTimeoutSecs = validateRange(input.requestTimeoutSecs, 1, defaults.requestTimeoutSecsMax, defaults.requestTimeoutSecs, 'requestTimeoutSecs');
    input.serpMaxRetries = validateRange(input.serpMaxRetries, 0, defaults.serpMaxRetriesMax, defaults.serpMaxRetries, 'serpMaxRetries');
    input.maxRequestRetries = validateRange(input.maxRequestRetries, 0, defaults.maxRequestRetriesMax, defaults.maxRequestRetries, 'maxRequestRetries');

    if (!input.outputFormats || input.outputFormats.length === 0) {
        input.outputFormats = defaults.outputFormats as OutputFormats[];
        log.warning(`The "outputFormats" parameter must be a non-empty array. Using default value ${defaults.outputFormats}.`);
    } else if (input.outputFormats.some((format) => !['text', 'markdown', 'html'].includes(format))) {
        throw new UserInputError('The "outputFormats" parameter must contain only "text", "markdown" or "html"');
    }
    if (input.serpProxyGroup !== 'GOOGLE_SERP' && input.serpProxyGroup !== 'SHADER') {
        throw new UserInputError('The "serpProxyGroup" parameter must be either "GOOGLE_SERP" or "SHADER"');
    }
    if (input.dynamicContentWaitSecs >= input.requestTimeoutSecs) {
        input.dynamicContentWaitSecs = Math.round(input.requestTimeoutSecs / 2);
    }
}
