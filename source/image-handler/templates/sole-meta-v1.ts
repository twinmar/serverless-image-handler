import sharp from "sharp";

import {
  ProductTemplate,
  TemplateContext,
} from "./types";

import { escapeXml } from "./helpers/escape-xml";
import { getS3Image } from "./helpers/s3";

export interface SoleMetaV1Data {
  secondaryKey?: string;

  brand?: string;
  product?: string;
  colour?: string;
  code?: string;
}

const WIDTH = 1080;
const HEIGHT = 1080;

const PRODUCT_WIDTH = 544;

const SOLE_LOGO_PATH =
  "m301.65,32.56c26.56,0,44.8,21.94,44.8,53.58s-18.25,52.89-44.8,52.89-44.8-21.02-44.8-52.89,18.25-53.58,44.8-53.58m219.17,94.46c0,4.62,3,7.62,8.54,7.62h67.9v32.33h-113.39V5.31h36.95v121.71Zm210.39-19.63v19.63c0,4.62,3,7.62,8.54,7.62h60.97v32.33h-106.23V5.31h103.92v30.95h-58.66c-5.54,0-8.54,2.77-8.54,7.39v18.94c0,4.62,3,7.62,8.54,7.62h26.1c10.39,0,15.7,6.7,15.7,14.78s-5.31,14.78-15.7,14.78h-26.1c-5.54,0-8.54,3-8.54,7.62M125.44,33.03l-27.94,17.32c-11.32-12.7-20.32-17.78-35.8-17.78-13.86,0-20.78,6.47-20.78,14.55,0,9.24,6.47,14.09,31.18,21.94,45.26,14.32,55.43,30.02,55.43,54.5,0,28.41-25.4,49.42-61.89,49.42-22.17,0-48.04-7.85-60.97-23.33-6.01-7.16-6.01-16.4-1.15-22.17,6-7.16,15.24-8.08,21.94-3.93,11.78,7.16,20.78,15.93,38.8,15.93s24.25-7.85,24.25-17.32c0-8.08-3.46-14.09-33.72-23.79C17.13,86.37,3.97,71.36,3.97,45.5,3.97,21.48,25.21,0,63.32,0c26.33,0,50.58,13.63,62.12,33.03m176.21,139.49c47.81,0,82.91-32.56,82.91-86.37S349.46,0,301.65,0s-82.91,34.87-82.91,86.14c0,53.81,35.1,86.37,82.91,86.37";


export const soleMetaV1: ProductTemplate<SoleMetaV1Data> = {
  async render(
    originalImage: sharp.Sharp,
    options: SoleMetaV1Data,
    context: TemplateContext
  ): Promise<sharp.Sharp> {
    if (!options.secondaryKey) {
      throw new Error(
        "secondaryKey is required for sole-meta-v1"
      );
    }

    /*
     * Primary image has already been retrieved by the
     * normal Serverless Image Handler flow.
     */
    const primaryBuffer =
      await originalImage.toBuffer();

    /*
     * Use exactly the same resolved bucket as the
     * original image.
     */
    const secondaryBuffer = await getS3Image(
      context.s3Client,
      context.sourceBucket,
      options.secondaryKey
    );

    const [sideImage, secondaryImage] = await Promise.all([
      sharp(primaryBuffer)
        .rotate()
        .resize({
          width: PRODUCT_WIDTH,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer(),

      sharp(secondaryBuffer)
        .rotate()
        .resize({
          width: PRODUCT_WIDTH,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer(),
    ]);

    const brand = escapeXml(
      options.brand ?? "FLOWER MOUNTAIN"
    );

    const product = escapeXml(
      options.product ?? ""
    );

    const colour = escapeXml(
      options.colour ?? ""
    );

    const code = escapeXml(
      options.code ?? ""
    );

    const layoutSvg = Buffer.from(`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${WIDTH}"
        height="${HEIGHT}"
        viewBox="0 0 ${WIDTH} ${HEIGHT}"
      >
        <!-- White left panel -->
        <rect
          x="0"
          y="0"
          width="${WIDTH}"
          height="${HEIGHT}"
          fill="#ffffff"
        />

        <!-- Divider -->
        <rect
          x="425"
          y="0"
          width="2"
          height="${HEIGHT}"
          fill="#3e261b"
        />

        <!-- Grey product area -->
        <rect
          x="446"
          y="0"
          width="634"
          height="${HEIGHT}"
          fill="#e6e6e6"
        />

        <!--
          Exact SOLE logo artwork from SOLE_Cobalt.svg.
          Using a nested SVG preserves its original viewBox.
        -->
        <svg
          x="50"
          y="40"
          width="154"
          height="34"
          viewBox="0 0 800.72 172.98"
          preserveAspectRatio="xMinYMin meet"
        >
          <path
            d="${SOLE_LOGO_PATH}"
            fill="#111bcc"
          />
        </svg>

        <!-- Vertical product metadata -->
        <g
          transform="translate(78 1042) rotate(-90)"
          font-family="Inter"
          fill="#000000"
        >
          <text
            x="0"
            y="0"
            font-size="35"
            font-weight="400"
          >${brand}</text>

          <text
            x="0"
            y="45"
            font-size="35"
            font-weight="400"
          >${product}</text>

          <text
            x="0"
            y="90"
            font-size="35"
            font-weight="400"
          >${colour}</text>
        </g>

        <!-- Product code -->
        <g
          transform="translate(382 1042) rotate(-90)"
          font-family="Inter"
          font-size="20"
          font-weight="400"
          fill="#b3b3b3"
        >
          <text x="0" y="0">
            ${code}
            <tspan font-size="14" dy="-2.25"> ▼</tspan>
          </text>
        </g>
      </svg>
    `);

    /*
     * Fixed 1:1 output.
     *
     * The original reference was 1080 x 1069.
     * The slight vertical repositioning below gives us
     * an actual 1080 x 1080 square while retaining the
     * same visual balance.
     */
    return sharp(layoutSvg).composite([
      {
        input: sideImage,
        left: 491,
        top: 145,
        blend: "multiply",
      },
      {
        input: secondaryImage,
        left: 491,
        top: 695,
        blend: "multiply",
      },
    ]);
  },
};