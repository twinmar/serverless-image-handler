import sharp from "sharp";

import {
  ImageHandlerError,
  StatusCodes,
} from "../lib";

import {
  TemplateContext,
  TemplateRequest,
} from "./types";

import { soletraderMetaV1 } from "./soletrader-meta-v1";
import { soleMetaV1 } from "./sole-meta-v1";

const templates = {
  "soletrader-meta-v1": soletraderMetaV1,
  "sole-meta-v1": soleMetaV1,
};

export async function renderTemplate(
  image: sharp.Sharp,
  request: TemplateRequest,
  context: TemplateContext
): Promise<sharp.Sharp> {
  const template = templates[request.name];

  if (!template) {
    throw new ImageHandlerError(
      StatusCodes.BAD_REQUEST,
      "Template::UnknownTemplate",
      `Unknown template: ${request.name}`
    );
  }

  return template.render(
    image,
    request.data ?? {},
    context
  );
}