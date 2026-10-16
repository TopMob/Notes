export interface ExportTile { x: number; y: number; width: number; height: number }

/** Preserve 2x resolution; bound each canvas to 64 MiB of RGBA pixels. */
export function planPngTiles(width: number, height: number): ExportTile[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Некорректный размер страницы.');
  width = Math.ceil(width); height = Math.ceil(height);
  if (width * 2 <= 8192 && height * 2 <= 8192 && width * height * 4 <= 16_777_216) return [{x:0,y:0,width,height}];
  const edge = 2048;
  if (Math.ceil(width / edge) * Math.ceil(height / edge) > 1024) throw new Error('Страница слишком велика для PNG-экспорта. Экспортируйте её частями.');
  const tiles: ExportTile[] = [];
  for (let y = 0; y < height; y += edge) for (let x = 0; x < width; x += edge) {
    tiles.push({x,y,width:Math.min(edge,width-x),height:Math.min(edge,height-y)});
  }
  return tiles;
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Браузер не смог создать PNG.')), 'image/png'));
}

const crcTable = Uint32Array.from({length:256}, (_,i) => {
  let crc=i; for(let bit=0;bit<8;bit++) crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;
  return crc>>>0;
});
async function crc32(blob: Blob): Promise<number> {
  let crc=0xffffffff;
  const reader=blob.stream().getReader();
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      for(const byte of value) crc=crcTable[(crc^byte)&255]^(crc>>>8);
    }
  } finally { reader.releaseLock(); }
  return (crc^0xffffffff)>>>0;
}

/** PNG is already compressed. Store its bytes verbatim in a standards ZIP32 archive. */
export async function zipFiles(files: {name:string;blob:Blob}[]): Promise<Blob> {
  if(files.length>65535) throw new Error('Слишком много частей экспорта.');
  const parts: BlobPart[]=[]; const directory: Uint8Array<ArrayBuffer>[]=[]; let offset=0;
  for(const file of files) {
    const name=new TextEncoder().encode(file.name);
    if(name.length>65535 || offset+file.blob.size+name.length+30>0xffffffff) throw new Error('Архив экспорта превышает 4 ГБ.');
    const crc=await crc32(file.blob);
    const local=new Uint8Array(30+name.length); const l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true); l.setUint16(6,0x800,true);
    l.setUint16(12,0x21,true); // DOS date: 1980-01-01, accepted by desktop extractors.
    l.setUint32(14,crc,true); l.setUint32(18,file.blob.size,true); l.setUint32(22,file.blob.size,true); l.setUint16(26,name.length,true); local.set(name,30);
    const central=new Uint8Array(46+name.length); const c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x800,true);
    c.setUint16(14,0x21,true);
    c.setUint32(16,crc,true); c.setUint32(20,file.blob.size,true); c.setUint32(24,file.blob.size,true); c.setUint16(28,name.length,true); c.setUint32(42,offset,true); central.set(name,46);
    parts.push(local,file.blob); directory.push(central); offset+=local.length+file.blob.size;
  }
  const size=directory.reduce((sum,part)=>sum+part.length,0);
  if(offset+size+22>0xffffffff) throw new Error('Архив экспорта превышает 4 ГБ.');
  const end=new Uint8Array(22); const e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,size,true); e.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
