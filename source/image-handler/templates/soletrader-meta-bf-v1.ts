import sharp from "sharp";

import {
  ProductTemplate,
  TemplateContext,
} from "./types";

import { escapeXml } from "./helpers/escape-xml";
import { getS3Image } from "./helpers/s3";

export interface SoletraderMetaBfV1Data {
  brand?: string;
  name?: string;
  wasPrice?: string;
  nowPrice?: string;
}

const WIDTH = 1080;
const HEIGHT = 1080;

const BACKGROUND = "#000000";
const PANEL_BACKGROUND = "#f4f4f4";

const PANEL_PADDING = 18;
const PANEL_RADIUS = 70;

/*
 * Black Friday graphic is displayed centrally,
 * below the Soletrader logo.
 */
const CAMPAIGN_WIDTH = 800;
const CAMPAIGN_TOP = 180;

/*
 * Product targets this width, unless doing so would
 * make it too tall for the available space.
 */
const PRODUCT_WIDTH = 800;

/*
 * Maximum top position the product is allowed to reach.
 * This allows the product to overlap the Black Friday
 * graphic while keeping it below the logo.
 */
const PRODUCT_TOP_Y = 330;

/*
 * Product bottom sits above the product name.
 */
const PRODUCT_BOTTOM_Y = 865;

/*
 * Soletrader logo is centred at the top of the panel.
 */
const LOGO_WIDTH = 390;
const LOGO_TOP = 55;

const NAME_FONT_SIZE = 35;
const NAME_Y = 925;

const PRICE_FONT_SIZE = 60;
const WAS_PRICE_FONT_SIZE = 55;

const PRICE_BOTTOM_Y = 1015;
const WAS_PRICE_RIGHT_X = 515;
const NOW_PRICE_LEFT_X = 565;

/*
 * Only remove pixels that are very close to pure white.
 * Keep white and light-coloured product details opaque.
 */
const WHITE_THRESHOLD_START = 252;
const WHITE_THRESHOLD_END = 255;

export const soletraderMetaBfV1: ProductTemplate<SoletraderMetaBfV1Data> = {
  async render(
    originalImage: sharp.Sharp,
    data: SoletraderMetaBfV1Data,
    context: TemplateContext
  ): Promise<sharp.Sharp> {
    const {
      brand,
      name,
      wasPrice,
      nowPrice,
    } = data;

    if (!context.brandingBucket) {
      throw new Error(
        "BRANDING_BUCKET is required for soletrader-meta-bf-v1"
      );
    }

    /*
     * Get the original product image.
     */
    const sourceBuffer = await originalImage.toBuffer();

    /*
     * Load Soletrader logo.
     */
    const rawLogo = await getS3Image(
      context.s3Client,
      context.brandingBucket,
      "logo.png"
    );

    const logo = await sharp(rawLogo)
      .resize({
        width: LOGO_WIDTH,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();

    const logoMetadata = await sharp(logo).metadata();
    const logoWidth = logoMetadata.width ?? 0;

    /*
     * Keep the logo horizontally centred.
     */
    const logoLeft = Math.round(
      (WIDTH - logoWidth) / 2
    );

    /*
     * Load the Black Friday campaign graphic.
     * The source PNG has a transparent background.
     */
    const rawCampaign = await getS3Image(
      context.s3Client,
      context.brandingBucket,
      "bf-ad-text.png"
    );

    const campaignBuffer = await sharp(rawCampaign)
      .resize({
        width: CAMPAIGN_WIDTH,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

    const campaignMetadata =
      await sharp(campaignBuffer).metadata();

    const campaignWidth = campaignMetadata.width ?? 0;

    /*
     * Keep the campaign graphic horizontally centred.
     */
    const campaignLeft = Math.round(
      (WIDTH - campaignWidth) / 2
    );

    /*
     * Maximum height available to the product image.
     * If a product would be too tall at 800px wide,
     * Sharp will scale it down to fit inside this height.
     */
    const productMaxHeight = Math.max(
      1,
      PRODUCT_BOTTOM_Y - PRODUCT_TOP_Y
    );

    /*
     * Resize the product image first.
     */
    const resizedProduct = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: PRODUCT_WIDTH,
        height: productMaxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    /*
     * Fade only near-white background pixels into
     * transparency so the Black Friday graphic can
     * sit behind the shoe.
     */
    const {
      data: productPixels,
      info: productInfo,
    } = resizedProduct;

    for (
      let i = 0;
      i < productPixels.length;
      i += productInfo.channels
    ) {
      const red = productPixels[i];
      const green = productPixels[i + 1];
      const blue = productPixels[i + 2];

      /*
       * Use the darkest RGB channel so every channel
       * must be near-white before transparency is applied.
       */
      const minChannel = Math.min(
        red,
        green,
        blue
      );

      /*
       * Pixels below 250 remain fully opaque.
       * Pixels between 250 and 255 fade to transparent.
       * Pure white pixels become completely transparent.
       */
      const alpha = Math.max(
        0,
        Math.min(
          1,
          (WHITE_THRESHOLD_END - minChannel) /
          (WHITE_THRESHOLD_END - WHITE_THRESHOLD_START)
        )
      );

      productPixels[i + 3] = Math.round(
        productPixels[i + 3] * alpha
      );
    }

    const productBuffer = await sharp(productPixels, {
      raw: {
        width: productInfo.width,
        height: productInfo.height,
        channels: productInfo.channels,
      },
    })
      .png()
      .toBuffer();

    const productMetadata =
      await sharp(productBuffer).metadata();

    const productWidth = productMetadata.width ?? 0;
    const productHeight = productMetadata.height ?? 0;

    /*
     * Keep the product horizontally centred.
     */
    const productLeft = Math.round(
      (WIDTH - productWidth) / 2
    );

    /*
     * Anchor the product from the bottom.
     * This allows the product to overlap the lower
     * section of the Black Friday graphic.
     */
    const productTop = Math.max(
      PRODUCT_TOP_Y,
      PRODUCT_BOTTOM_Y - productHeight
    );

    /*
     * Fixed square background with a rounded panel.
     */
    const backgroundSvg = Buffer.from(`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${WIDTH}"
        height="${HEIGHT}"
        viewBox="0 0 ${WIDTH} ${HEIGHT}"
      >
        <rect
          x="0"
          y="0"
          width="${WIDTH}"
          height="${HEIGHT}"
          fill="${BACKGROUND}"
        />

        <rect
          x="${PANEL_PADDING}"
          y="${PANEL_PADDING}"
          width="${WIDTH - PANEL_PADDING * 2}"
          height="${HEIGHT - PANEL_PADDING * 2}"
          rx="${PANEL_RADIUS}"
          ry="${PANEL_RADIUS}"
          fill="${PANEL_BACKGROUND}"
        />
      </svg>
    `);

    /*
     * Product name and pricing.
     */
    const metadataSvg = Buffer.from(`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${WIDTH}"
        height="${HEIGHT}"
        viewBox="0 0 ${WIDTH} ${HEIGHT}"
      >
        ${
          name || brand
            ? `
              <text
                x="${WIDTH / 2}"
                y="${NAME_Y}"
                text-anchor="middle"
                font-family="Poppins"
                font-size="${NAME_FONT_SIZE}"
                font-weight="400"
                fill="#000000"
              >${escapeXml(
                [brand, name].filter(Boolean).join(" ")
              )}</text>
            `
            : ""
        }

        ${
          nowPrice &&
          (nowPrice === wasPrice || !wasPrice)
            ? `
              <text
                x="${WIDTH / 2}"
                y="${PRICE_BOTTOM_Y}"
                text-anchor="middle"
                font-family="Poppins"
                font-size="${PRICE_FONT_SIZE}"
                font-weight="700"
                fill="#000000"
              >${escapeXml(nowPrice)}</text>
            `
            : ""
        }

        ${
          nowPrice &&
          wasPrice &&
          wasPrice !== nowPrice
            ? `
              <text
                x="${WAS_PRICE_RIGHT_X}"
                y="${PRICE_BOTTOM_Y}"
                text-anchor="end"
                font-family="Poppins"
                font-size="${WAS_PRICE_FONT_SIZE}"
                font-weight="400"
                fill="#000000"
                text-decoration="line-through"
              >${escapeXml(wasPrice)}</text>

              <text
                x="${NOW_PRICE_LEFT_X}"
                y="${PRICE_BOTTOM_Y}"
                text-anchor="start"
                font-family="Poppins"
                font-size="${PRICE_FONT_SIZE}"
                font-weight="700"
                fill="#000000"
              >${escapeXml(nowPrice)}</text>
            `
            : ""
        }
      </svg>
    `);

    return sharp(backgroundSvg).composite([
      {
        input: campaignBuffer,
        left: campaignLeft,
        top: CAMPAIGN_TOP,
        blend: "over",
      },
      {
        input: productBuffer,
        left: productLeft,
        top: productTop,
        blend: "over",
      },
      {
        input: logo,
        left: logoLeft,
        top: LOGO_TOP,
        blend: "over",
      },
      {
        input: metadataSvg,
        left: 0,
        top: 0,
        blend: "over",
      },
    ]);
  },
};
