import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1E4A7A",
          borderRadius: 8,
          color: "#D3368A",
          fontSize: 22,
          fontWeight: 700,
          fontFamily: "Georgia, 'Times New Roman', serif",
          lineHeight: 1,
        }}
      >
        $
      </div>
    ),
    { ...size }
  );
}
