function unavailable(){throw new Error('Este recurso ainda não foi integrado ao Center local.');}
export const verificarServidor=unavailable;
export const atualizarUsuario=unavailable,criarUsuario=unavailable,excluirUsuario=unavailable;
export async function registrarAtividade(){return {local:true};}
export const listarSessoes=unavailable,encerrarSessao=unavailable,forcarLayout=unavailable;
export const identificarMonitoresDoUsuario=unavailable,identificarTela=unavailable,iniciarTelasDoUsuario=unavailable;
