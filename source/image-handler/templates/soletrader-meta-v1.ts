import sharp from "sharp";

import {
  ProductTemplate,
  TemplateContext,
} from "./types";

import { escapeXml } from "./helpers/escape-xml";
import { getS3Image } from "./helpers/s3";

export interface SoletraderMetaV1Data {
  brand?: string;
  name?: string;
  wasPrice?: string;
  nowPrice?: string;
}

const WIDTH = 1080;
const HEIGHT = 1080;

const BACKGROUND = "#f4f4f4";

/*
 * Product targets this width, unless doing so would
 * make it too tall for the available space.
 */
const PRODUCT_WIDTH = 800;

/*
 * Gap between the bottom of the product image and the
 * top of the Soletrader logo.
 */
const PRODUCT_LOGO_GAP = 45;

const PADDING = 40;

const ACCENT_X = PADDING;
const ACCENT_Y = PADDING;
const ACCENT_WIDTH = 6;
const ACCENT_HEIGHT = 108;

const TEXT_X = 78;

const BRAND_FONT_SIZE = 54;
const NAME_FONT_SIZE = 35;

const BRAND_Y = 94;
const NAME_Y = 147;

/*
 * Maximum top position the product is allowed to reach.
 * This keeps the product sitting just below the top text.
 */
const PRODUCT_TOP_Y = NAME_Y + 40;

const PRICE_RIGHT_X = WIDTH - PADDING;
const PRICE_BOTTOM_Y = HEIGHT - PADDING;

const PRICE_FONT_SIZE = 43;
const WAS_PRICE_FONT_SIZE = 30;

export const soletraderMetaV1: ProductTemplate<SoletraderMetaV1Data> = {
  async render(
    originalImage: sharp.Sharp,
    data: SoletraderMetaV1Data,
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
        "BRANDING_BUCKET is required for soletrader-meta-v1"
      );
    }

    /*
     * Get the original product image.
     */
    const sourceBuffer = await originalImage.toBuffer();

    /*
     * Load Soletrader logo first, because the available
     * product space depends on where the logo sits.
     */
    const rawLogo = await getS3Image(
      context.s3Client,
      context.brandingBucket,
      "logo.png"
    );

    const logo = await sharp(rawLogo)
      .resize({
        width: Math.floor(WIDTH * 0.35),
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();

    const logoMetadata = await sharp(logo).metadata();
    const logoHeight = logoMetadata.height ?? 0;

    const logoLeft = PADDING;

    /*
     * Logo is anchored to the bottom-left.
     */
    const logoTop = Math.max(
      0,
      HEIGHT - PADDING - logoHeight
    );

    /*
     * Product bottom sits a fixed distance above the logo.
     */
    const productBottom = logoTop - PRODUCT_LOGO_GAP;

    /*
     * Maximum height available to the product image.
     * If a product would be too tall at 800px wide,
     * Sharp will scale it down to fit inside this height.
     */
    const productMaxHeight = Math.max(
      1,
      productBottom - PRODUCT_TOP_Y
    );

    /*
     * Try to render at 800px wide, but constrain height
     * so the product never overlaps the top metadata area.
     */
    const productBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: PRODUCT_WIDTH,
        height: productMaxHeight,
        fit: "inside",
        withoutEnlargement: true,
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
     */
    const productTop = Math.max(
      PRODUCT_TOP_Y,
      productBottom - productHeight
    );

    /*
     * Fixed square background.
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
      </svg>
    `);

    const metadataSvg = Buffer.from(`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${WIDTH}"
        height="${HEIGHT}"
        viewBox="0 0 ${WIDTH} ${HEIGHT}"
      >
        <!-- Accent -->
        <rect
          x="${ACCENT_X}"
          y="${ACCENT_Y}"
          width="${ACCENT_WIDTH}"
          height="${ACCENT_HEIGHT}"
          fill="#f58220"
        />

        ${
          brand
            ? `
              <text
                x="${TEXT_X}"
                y="${BRAND_Y}"
                font-family="Poppins"
                font-size="${BRAND_FONT_SIZE}"
                font-weight="700"
                fill="#000000"
              >${escapeXml(brand)}</text>
            `
            : ""
        }

        ${
          name
            ? `
              <text
                x="${TEXT_X}"
                y="${NAME_Y}"
                font-family="Poppins"
                font-size="${NAME_FONT_SIZE}"
                font-weight="400"
                fill="#666666"
              >${escapeXml(name)}</text>
            `
            : ""
        }

        ${
          nowPrice &&
          (nowPrice === wasPrice || !wasPrice)
            ? `
              <text
                x="${PRICE_RIGHT_X}"
                y="${PRICE_BOTTOM_Y}"
                text-anchor="end"
                font-family="Poppins"
                font-size="${PRICE_FONT_SIZE}"
                font-weight="400"
                fill="#111111"
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
                x="${PRICE_RIGHT_X}"
                y="${
                  PRICE_BOTTOM_Y -
                  Math.round(PRICE_FONT_SIZE * 1.1)
                }"
                text-anchor="end"
                font-family="Poppins"
                font-size="${WAS_PRICE_FONT_SIZE}"
                font-weight="400"
                fill="#777777"
                text-decoration="line-through"
              >${escapeXml(wasPrice)}</text>

              <text
                x="${PRICE_RIGHT_X}"
                y="${PRICE_BOTTOM_Y}"
                text-anchor="end"
                font-family="Poppins"
                font-size="${PRICE_FONT_SIZE}"
                font-weight="400"
                fill="#d71920"
              >${escapeXml(nowPrice)}</text>
            `
            : ""
        }
      </svg>
    `);

    return sharp(backgroundSvg).composite([
      {
        input: productBuffer,
        left: productLeft,
        top: productTop,
        blend: "multiply",
      },
      {
        input: metadataSvg,
        left: 0,
        top: 0,
        blend: "over",
      },
      {
        input: logo,
        left: logoLeft,
        top: logoTop,
        blend: "over",
      },
    ]);
  },
};