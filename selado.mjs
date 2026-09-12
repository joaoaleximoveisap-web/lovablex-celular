// Caixa selada (libsodium crypto_box_seal) feita com tweetnacl + blake2b.
// O GitHub exige que o valor de um secret chegue criptografado com a chave
// pública do repositório. Assim o token do Claude sai do celular já fechado:
// nem o app nem ninguém no caminho consegue ler depois.
//
//   nonce  = blake2b(chaveEfemeraPublica || chavePublicaDoRepo, 24 bytes)
//   saida  = chaveEfemeraPublica || nacl.box(mensagem, nonce, chaveDoRepo, chaveEfemeraSecreta)
export function selar(nacl, blake2b, mensagem, chavePublica) {
  const efemera = nacl.box.keyPair();
  const entrada = new Uint8Array(64);
  entrada.set(efemera.publicKey, 0);
  entrada.set(chavePublica, 32);
  const nonce = blake2b(entrada, undefined, 24);
  const caixa = nacl.box(mensagem, nonce, chavePublica, efemera.secretKey);
  const saida = new Uint8Array(32 + caixa.length);
  saida.set(efemera.publicKey, 0);
  saida.set(caixa, 32);
  return saida;
}
