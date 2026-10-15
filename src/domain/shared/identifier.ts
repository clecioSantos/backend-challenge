import { v7 as uuidv7 } from 'uuid';

/**
 * Gera um UUID ordenado por tempo (v7). A ordenação temporal mantém as
 * inserções de chave primária próximas da borda direita da B-tree, o que
 * mantém o inchaço do índice baixo em comparação com identificadores v4. O
 * gerador vive no domínio porque os identificadores fazem parte da identidade
 * do aggregate, não de um detalhe de infraestrutura.
 */
export function newId(): string {
  return uuidv7();
}
