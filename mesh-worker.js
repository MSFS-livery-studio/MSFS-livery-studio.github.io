/* MSFS Livery Studio Web v0.7.3 - HD mesh decoder worker */
onmessage = (ev) => {
  try {
    const buf = ev.data;
    const dv = new DataView(buf);
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 8));
    if (magic !== 'MLSHD003') throw new Error('Invalid high-detail preview mesh');

    const vertexCount = dv.getUint32(8, true);
    const indexCount = dv.getUint32(12, true);
    const groupCount = dv.getUint16(16, true);
    const minX = dv.getFloat32(20, true), minY = dv.getFloat32(24, true), minZ = dv.getFloat32(28, true);
    const maxX = dv.getFloat32(32, true), maxY = dv.getFloat32(36, true), maxZ = dv.getFloat32(40, true);

    const groups = [];
    let off = 44;
    for (let i = 0; i < groupCount; i++) {
      groups.push({ start: dv.getUint32(off, true), count: dv.getUint32(off + 4, true) });
      off += 8;
    }

    const vertexOffset = off;
    const recordSize = 16;
    const indexOffset = vertexOffset + vertexCount * recordSize;
    if (buf.byteLength < indexOffset + indexCount * 4) throw new Error('High-detail mesh is truncated');

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    const sx = (maxX - minX) / 65535;
    const sy = (maxY - minY) / 65535;
    const sz = (maxZ - minZ) / 65535;

    let p = vertexOffset;
    for (let i = 0; i < vertexCount; i++, p += recordSize) {
      const qx = dv.getUint16(p, true), qy = dv.getUint16(p + 2, true), qz = dv.getUint16(p + 4, true);
      const nx = dv.getInt16(p + 6, true), ny = dv.getInt16(p + 8, true), nz = dv.getInt16(p + 10, true);
      const qu = dv.getUint16(p + 12, true), qv = dv.getUint16(p + 14, true);

      const pi = i * 3, ui = i * 2;
      positions[pi] = minX + qx * sx;
      positions[pi + 1] = minY + qy * sy;
      positions[pi + 2] = minZ + qz * sz;
      normals[pi] = nx / 32767;
      normals[pi + 1] = ny / 32767;
      normals[pi + 2] = nz / 32767;
      uvs[ui] = qu / 65535;
      uvs[ui + 1] = qv / 65535;
    }

    // Copy aligned uint32 index data because the header is not guaranteed to align a typed-array view safely.
    const indices = new Uint32Array(indexCount);
    let q = indexOffset;
    for (let i = 0; i < indexCount; i++, q += 4) indices[i] = dv.getUint32(q, true);

    postMessage({
      positions: positions.buffer,
      normals: normals.buffer,
      uvs: uvs.buffer,
      indices: indices.buffer,
      groups,
      vertexCount,
      indexCount
    }, [positions.buffer, normals.buffer, uvs.buffer, indices.buffer]);
  } catch (err) {
    postMessage({ error: err?.message || String(err) });
  }
};
