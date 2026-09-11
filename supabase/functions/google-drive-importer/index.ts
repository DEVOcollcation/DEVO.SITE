// ==============================================================================
// Supabase Edge Function: google-drive-importer
// Scans Google Drive folders for DEVO models images using Google Drive API v3
// ==============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  folderId?: string;
  folderUrl?: string;
  apiKey?: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { folderId, folderUrl, apiKey: clientApiKey } = (await req.json()) as RequestBody;

    // Determine target folder ID
    let targetFolderId = folderId;
    if (!targetFolderId && folderUrl) {
      const match = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match) targetFolderId = match[1];
      else targetFolderId = folderUrl.trim();
    }

    if (!targetFolderId) {
      return new Response(
        JSON.stringify({ error: "Missing folderId or folderUrl" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Google API Key from Deno env or client
    const apiKey = clientApiKey || Deno.env.get("GOOGLE_DRIVE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "Google Drive API Key is required. Configure GOOGLE_DRIVE_API_KEY in Supabase secrets or pass apiKey."
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Helper to query Google Drive files
    async function listDriveFiles(query: string) {
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        query
      )}&fields=files(id,name,mimeType,size,createdTime)&pageSize=1000&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Google Drive API error (${res.status}): ${errText}`);
      }
      const data = await res.json();
      return data.files || [];
    }

    // 1. Fetch all items in target folder
    const topLevelItems = await listDriveFiles(`'${targetFolderId}' in parents and trashed = false`);

    // 2. Separate into subfolders and direct images
    const subfolders = topLevelItems.filter(
      (item: any) => item.mimeType === "application/vnd.google-apps.folder"
    );
    const directImages = topLevelItems.filter(
      (item: any) => item.mimeType && item.mimeType.startsWith("image/")
    );

    // 3. For each subfolder, fetch images inside it
    const subfolderImagesPromises = subfolders.map(async (folder: any) => {
      const files = await listDriveFiles(
        `'${folder.id}' in parents and mimeType contains 'image/' and trashed = false`
      );
      return {
        folderName: folder.name,
        folderId: folder.id,
        files: files.map((f: any) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          thumbnailUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1000`,
        })),
      };
    });

    const subfoldersWithImages = await Promise.all(subfolderImagesPromises);

    return new Response(
      JSON.stringify({
        success: true,
        targetFolderId,
        directImages: directImages.map((f: any) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          thumbnailUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1000`,
        })),
        subfolders: subfoldersWithImages,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
