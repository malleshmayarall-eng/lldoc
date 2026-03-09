const stripUndefined = (payload) =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

export const getImageReferenceId = (image) => {
  if (!image) return null;
  const candidate =
    image.image_reference_id ||
    image.image_reference ||
    image.imageReference ||
    image.image_id ||
    image.imageId ||
    image.document_image_id ||
    image.document_image?.id ||
    image.image?.id;

  if (candidate && typeof candidate === 'object') {
    return candidate.id || candidate.uuid || null;
  }

  return candidate || null;
};

export const normalizeImageForSave = (image, options = {}) => {
  if (!image) return null;
  const { includeId = true, includeClientId = true } = options;
  const imageReferenceId = getImageReferenceId(image);

  const payload = {
    id: includeId ? image.id : undefined,
    client_id: includeClientId ? image.client_id : undefined,
    image_reference_id: imageReferenceId,
    component_type: image.component_type,
    alignment: image.alignment,
    size_mode: image.size_mode,
    custom_width_percent: image.custom_width_percent,
    custom_width_pixels: image.custom_width_pixels,
    custom_height_pixels: image.custom_height_pixels,
    maintain_aspect_ratio: image.maintain_aspect_ratio,
    figure_number: image.figure_number,
    title: image.title,
    caption: image.caption,
    alt_text: image.alt_text,
    show_figure_number: image.show_figure_number,
    show_caption: image.show_caption,
    margin_top: image.margin_top,
    margin_bottom: image.margin_bottom,
    margin_left: image.margin_left,
    margin_right: image.margin_right,
    show_border: image.show_border,
    border_color: image.border_color,
    border_width: image.border_width,
    link_url: image.link_url,
    is_visible: image.is_visible,
    order: image.order ?? image.order_index,
  };

  return stripUndefined(payload);
};

export const normalizeImagesForSave = (images = [], options = {}) =>
  (images || [])
    .map((image) => normalizeImageForSave(image, options))
    .filter((image) => image?.image_reference_id);
