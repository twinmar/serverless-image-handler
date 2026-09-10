import { S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

export type TemplateName =
  | "soletrader-meta-v1"
  | "sole-meta-v1";

export interface TemplateRequest<T = Record<string, unknown>> {
  name: TemplateName;
  data?: T;
}

export interface TemplateContext {
  s3Client: S3Client;

  /**
   * Bucket containing the primary product image.
   */
  sourceBucket: string;

  /**
   * Bucket containing logos / branding assets.
   */
  brandingBucket?: string;
}

export interface ProductTemplate<T = Record<string, unknown>> {
  render(
    image: sharp.Sharp,
    data: T,
    context: TemplateContext
  ): Promise<sharp.Sharp>;
}