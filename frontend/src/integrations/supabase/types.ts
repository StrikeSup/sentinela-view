export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      gear_acessos_celular: {
        Row: {
          hash: string
          dados: string
          status: string
          user_id: string | null
          ip: string | null
          ua: string | null
          ultimo_dvr: string | null
          pedidos: number
          primeiro_visto: string
          ultimo_visto: string
          liberado_por: string | null
          liberado_em: string | null
        }
        Insert: {
          hash: string
          dados?: string
          status?: string
          user_id?: string | null
          ip?: string | null
          ua?: string | null
          ultimo_dvr?: string | null
          pedidos?: number
          primeiro_visto?: string
          ultimo_visto?: string
          liberado_por?: string | null
          liberado_em?: string | null
        }
        Update: {
          hash?: string
          dados?: string
          status?: string
          user_id?: string | null
          ip?: string | null
          ua?: string | null
          ultimo_dvr?: string | null
          pedidos?: number
          primeiro_visto?: string
          ultimo_visto?: string
          liberado_por?: string | null
          liberado_em?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          favicon_url: string | null
          id: boolean
          login_selo: string
          login_titulo: string
          login_titulo_destaque: string
          logo_compacto_url: string | null
          logo_login_url: string | null
          logo_tamanho_compacto: number
          logo_tamanho_login: number
          logo_tamanho_menu: number
          logo_url: string | null
          nome_sistema: string
          palavra_destaque: string | null
          paleta_nome: string
          subtitulo: string
          tema_claro: Json
          tema_escuro: Json
          updated_at: string
        }
        Insert: {
          favicon_url?: string | null
          id?: boolean
          login_selo?: string
          login_titulo?: string
          login_titulo_destaque?: string
          logo_compacto_url?: string | null
          logo_login_url?: string | null
          logo_tamanho_compacto?: number
          logo_tamanho_login?: number
          logo_tamanho_menu?: number
          logo_url?: string | null
          nome_sistema?: string
          palavra_destaque?: string | null
          paleta_nome?: string
          subtitulo?: string
          tema_claro?: Json
          tema_escuro?: Json
          updated_at?: string
        }
        Update: {
          favicon_url?: string | null
          id?: boolean
          login_selo?: string
          login_titulo?: string
          login_titulo_destaque?: string
          logo_compacto_url?: string | null
          logo_login_url?: string | null
          logo_tamanho_compacto?: number
          logo_tamanho_login?: number
          logo_tamanho_menu?: number
          logo_url?: string | null
          nome_sistema?: string
          palavra_destaque?: string | null
          paleta_nome?: string
          subtitulo?: string
          tema_claro?: Json
          tema_escuro?: Json
          updated_at?: string
        }
        Relationships: []
      }
      arquivos_gravados: {
        Row: {
          camera_nome: string | null
          canal: number | null
          cliente_id: string | null
          created_at: string
          disponivel: boolean
          download_range: boolean
          download_url: string | null
          duracao_segundos: number | null
          dvr_id: string | null
          dvr_nome: string | null
          fim: string | null
          formato: string | null
          fuso_horario: string | null
          id: string
          inicio: string
          inicio_epoch_ms: number | null
          servidor_id: string
          tamanho_bytes: number | null
          visto_em: string
        }
        Insert: {
          camera_nome?: string | null
          canal?: number | null
          cliente_id?: string | null
          created_at?: string
          disponivel?: boolean
          download_range?: boolean
          download_url?: string | null
          duracao_segundos?: number | null
          dvr_id?: string | null
          dvr_nome?: string | null
          fim?: string | null
          formato?: string | null
          fuso_horario?: string | null
          id: string
          inicio: string
          inicio_epoch_ms?: number | null
          servidor_id: string
          tamanho_bytes?: number | null
          visto_em?: string
        }
        Update: {
          camera_nome?: string | null
          canal?: number | null
          cliente_id?: string | null
          created_at?: string
          disponivel?: boolean
          download_range?: boolean
          download_url?: string | null
          duracao_segundos?: number | null
          dvr_id?: string | null
          dvr_nome?: string | null
          fim?: string | null
          formato?: string | null
          fuso_horario?: string | null
          id?: string
          inicio?: string
          inicio_epoch_ms?: number | null
          servidor_id?: string
          tamanho_bytes?: number | null
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "arquivos_gravados_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_gravados_dvr_id_fkey"
            columns: ["dvr_id"]
            isOneToOne: false
            referencedRelation: "dvrs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_gravados_servidor_id_fkey"
            columns: ["servidor_id"]
            isOneToOne: false
            referencedRelation: "servidores"
            referencedColumns: ["id"]
          },
        ]
      }
      cameras: {
        Row: {
          canal: number
          cliente_id: string | null
          created_at: string
          dvr_id: string
          id: string
          nome: string | null
          online: boolean
          path: string | null
          servidor_id: string | null
          updated_at: string
          visto_em: string
        }
        Insert: {
          canal: number
          cliente_id?: string | null
          created_at?: string
          dvr_id: string
          id?: string
          nome?: string | null
          online?: boolean
          path?: string | null
          servidor_id?: string | null
          updated_at?: string
          visto_em?: string
        }
        Update: {
          canal?: number
          cliente_id?: string | null
          created_at?: string
          dvr_id?: string
          id?: string
          nome?: string | null
          online?: boolean
          path?: string | null
          servidor_id?: string | null
          updated_at?: string
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "cameras_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cameras_dvr_id_fkey"
            columns: ["dvr_id"]
            isOneToOne: false
            referencedRelation: "dvrs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cameras_servidor_id_fkey"
            columns: ["servidor_id"]
            isOneToOne: false
            referencedRelation: "servidores"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          ativo: boolean
          contato_email: string | null
          contato_nome: string | null
          contato_telefone: string | null
          created_at: string
          documento: string | null
          id: string
          max_licencas_dvr: number
          max_servidores: number
          nome: string
          observacoes: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          documento?: string | null
          id?: string
          max_licencas_dvr?: number
          max_servidores?: number
          nome: string
          observacoes?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          documento?: string | null
          id?: string
          max_licencas_dvr?: number
          max_servidores?: number
          nome?: string
          observacoes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dvrs: {
        Row: {
          ativo: boolean
          canais: number
          canais_gravacao: number[]
          cliente_id: string
          cloud: string | null
          created_at: string
          deteccao_confianca: number | null
          detectado_em: string | null
          dias_backup: number
          driver: string | null
          fabricante: string | null
          firmware: string | null
          id: string
          ip_externo: string | null
          ip_interno: string | null
          modelo: string | null
          nome: string
          observacao: string | null
          online: boolean
          onvif: boolean | null
          perfil_minimo: Database["public"]["Enums"]["app_role"]
          perfis_base: Database["public"]["Enums"]["app_role"][]
          perfis_ids: string[]
          plataforma: string | null
          porta_cloud: number | null
          porta_http_cloud: number | null
          porta_http_externa: number | null
          porta_http_interna: number | null
          porta_rtsp_externa: number | null
          porta_rtsp_interna: number | null
          porta_servico_externa: number | null
          porta_servico_interna: number | null
          prioridade_conexao: string[]
          senha: string | null
          serial: string | null
          servidor_id: string | null
          status_atualizado_em: string | null
          status_http: string | null
          status_motivo: string | null
          status_origem: string | null
          status_rtsp: string | null
          status_texto: string
          status_video: string | null
          ultimo_sinal_em: string | null
          ultimo_status_em: string | null
          updated_at: string
          usuario: string | null
        }
        Insert: {
          ativo?: boolean
          canais?: number
          canais_gravacao?: number[]
          cliente_id: string
          cloud?: string | null
          created_at?: string
          deteccao_confianca?: number | null
          detectado_em?: string | null
          dias_backup?: number
          driver?: string | null
          fabricante?: string | null
          firmware?: string | null
          id?: string
          ip_externo?: string | null
          ip_interno?: string | null
          modelo?: string | null
          nome: string
          observacao?: string | null
          online?: boolean
          onvif?: boolean | null
          perfil_minimo?: Database["public"]["Enums"]["app_role"]
          perfis_base?: Database["public"]["Enums"]["app_role"][]
          perfis_ids?: string[]
          plataforma?: string | null
          porta_cloud?: number | null
          porta_http_cloud?: number | null
          porta_http_externa?: number | null
          porta_http_interna?: number | null
          porta_rtsp_externa?: number | null
          porta_rtsp_interna?: number | null
          porta_servico_externa?: number | null
          porta_servico_interna?: number | null
          prioridade_conexao?: string[]
          senha?: string | null
          serial?: string | null
          servidor_id?: string | null
          status_atualizado_em?: string | null
          status_http?: string | null
          status_motivo?: string | null
          status_origem?: string | null
          status_rtsp?: string | null
          status_texto?: string
          status_video?: string | null
          ultimo_sinal_em?: string | null
          ultimo_status_em?: string | null
          updated_at?: string
          usuario?: string | null
        }
        Update: {
          ativo?: boolean
          canais?: number
          canais_gravacao?: number[]
          cliente_id?: string
          cloud?: string | null
          created_at?: string
          deteccao_confianca?: number | null
          detectado_em?: string | null
          dias_backup?: number
          driver?: string | null
          fabricante?: string | null
          firmware?: string | null
          id?: string
          ip_externo?: string | null
          ip_interno?: string | null
          modelo?: string | null
          nome?: string
          observacao?: string | null
          online?: boolean
          onvif?: boolean | null
          perfil_minimo?: Database["public"]["Enums"]["app_role"]
          perfis_base?: Database["public"]["Enums"]["app_role"][]
          perfis_ids?: string[]
          plataforma?: string | null
          porta_cloud?: number | null
          porta_http_cloud?: number | null
          porta_http_externa?: number | null
          porta_http_interna?: number | null
          porta_rtsp_externa?: number | null
          porta_rtsp_interna?: number | null
          porta_servico_externa?: number | null
          porta_servico_interna?: number | null
          prioridade_conexao?: string[]
          senha?: string | null
          serial?: string | null
          servidor_id?: string | null
          status_atualizado_em?: string | null
          status_http?: string | null
          status_motivo?: string | null
          status_origem?: string | null
          status_rtsp?: string | null
          status_texto?: string
          status_video?: string | null
          ultimo_sinal_em?: string | null
          ultimo_status_em?: string | null
          updated_at?: string
          usuario?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dvrs_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvrs_servidor_id_fkey"
            columns: ["servidor_id"]
            isOneToOne: false
            referencedRelation: "servidores"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_conexao: {
        Row: {
          cliente_id: string | null
          created_at: string
          detalhe: string | null
          duracao_segundos: number | null
          dvr_id: string | null
          id: string
          ocorrido_em: string
          servidor_id: string | null
          tipo: Database["public"]["Enums"]["evento_tipo"]
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          detalhe?: string | null
          duracao_segundos?: number | null
          dvr_id?: string | null
          id?: string
          ocorrido_em?: string
          servidor_id?: string | null
          tipo: Database["public"]["Enums"]["evento_tipo"]
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          detalhe?: string | null
          duracao_segundos?: number | null
          dvr_id?: string | null
          id?: string
          ocorrido_em?: string
          servidor_id?: string | null
          tipo?: Database["public"]["Enums"]["evento_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "eventos_conexao_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_conexao_dvr_id_fkey"
            columns: ["dvr_id"]
            isOneToOne: false
            referencedRelation: "dvrs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_conexao_servidor_id_fkey"
            columns: ["servidor_id"]
            isOneToOne: false
            referencedRelation: "servidores"
            referencedColumns: ["id"]
          },
        ]
      }
      gravacoes: {
        Row: {
          canal: number | null
          cliente_id: string | null
          created_at: string
          dvr_id: string
          fim: string
          id: string
          inicio: string
          tamanho_mb: number | null
          url: string | null
        }
        Insert: {
          canal?: number | null
          cliente_id?: string | null
          created_at?: string
          dvr_id: string
          fim: string
          id?: string
          inicio: string
          tamanho_mb?: number | null
          url?: string | null
        }
        Update: {
          canal?: number | null
          cliente_id?: string | null
          created_at?: string
          dvr_id?: string
          fim?: string
          id?: string
          inicio?: string
          tamanho_mb?: number | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gravacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gravacoes_dvr_id_fkey"
            columns: ["dvr_id"]
            isOneToOne: false
            referencedRelation: "dvrs"
            referencedColumns: ["id"]
          },
        ]
      }
      layouts_visualizacao: {
        Row: {
          cliente_id: string | null
          colunas: number
          created_at: string
          criado_por: string | null
          id: string
          linhas: number
          nome: string
          slots: Json
          template: string | null
          updated_at: string
        }
        Insert: {
          cliente_id?: string | null
          colunas?: number
          created_at?: string
          criado_por?: string | null
          id?: string
          linhas?: number
          nome: string
          slots?: Json
          template?: string | null
          updated_at?: string
        }
        Update: {
          cliente_id?: string | null
          colunas?: number
          created_at?: string
          criado_por?: string | null
          id?: string
          linhas?: number
          nome?: string
          slots?: Json
          template?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "layouts_visualizacao_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      licencas: {
        Row: {
          codigo: string
          created_at: string
          id: string
          motivo: string | null
          revogada_em: string | null
          servidor_id: string
          status: Database["public"]["Enums"]["licenca_status"]
          vinculada_em: string
        }
        Insert: {
          codigo: string
          created_at?: string
          id?: string
          motivo?: string | null
          revogada_em?: string | null
          servidor_id: string
          status?: Database["public"]["Enums"]["licenca_status"]
          vinculada_em?: string
        }
        Update: {
          codigo?: string
          created_at?: string
          id?: string
          motivo?: string | null
          revogada_em?: string | null
          servidor_id?: string
          status?: Database["public"]["Enums"]["licenca_status"]
          vinculada_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "licencas_servidor_id_fkey"
            columns: ["servidor_id"]
            isOneToOne: false
            referencedRelation: "servidores"
            referencedColumns: ["id"]
          },
        ]
      }
      logs_auditoria: {
        Row: {
          acao: string
          antes: Json | null
          cliente_id: string | null
          created_at: string
          depois: Json | null
          descricao: string
          id: string
          registro_id: string | null
          tabela: string
          user_email: string | null
          user_id: string | null
          user_nome: string | null
        }
        Insert: {
          acao: string
          antes?: Json | null
          cliente_id?: string | null
          created_at?: string
          depois?: Json | null
          descricao: string
          id?: string
          registro_id?: string | null
          tabela: string
          user_email?: string | null
          user_id?: string | null
          user_nome?: string | null
        }
        Update: {
          acao?: string
          antes?: Json | null
          cliente_id?: string | null
          created_at?: string
          depois?: Json | null
          descricao?: string
          id?: string
          registro_id?: string | null
          tabela?: string
          user_email?: string | null
          user_id?: string | null
          user_nome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_auditoria_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      mosaicos_personalizados: {
        Row: {
          celulas: Json
          cliente_id: string | null
          colunas: number
          created_at: string
          criado_por: string | null
          id: string
          linhas: number
          nome: string
          updated_at: string
        }
        Insert: {
          celulas?: Json
          cliente_id?: string | null
          colunas?: number
          created_at?: string
          criado_por?: string | null
          id?: string
          linhas?: number
          nome: string
          updated_at?: string
        }
        Update: {
          celulas?: Json
          cliente_id?: string | null
          colunas?: number
          created_at?: string
          criado_por?: string | null
          id?: string
          linhas?: number
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mosaicos_personalizados_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      perfis: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"]
          cliente_id: string
          created_at: string
          descricao: string | null
          id: string
          nome: string
          permissions: Database["public"]["Enums"]["app_permission"][]
          updated_at: string
        }
        Insert: {
          base_role?: Database["public"]["Enums"]["app_role"]
          cliente_id: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          permissions?: Database["public"]["Enums"]["app_permission"][]
          updated_at?: string
        }
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"]
          cliente_id?: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          permissions?: Database["public"]["Enums"]["app_permission"][]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfis_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          nome: string
          perfil_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          id: string
          nome?: string
          perfil_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          nome?: string
          perfil_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_perfil_id_fkey"
            columns: ["perfil_id"]
            isOneToOne: false
            referencedRelation: "perfis"
            referencedColumns: ["id"]
          },
        ]
      }
      recording_playback_exports: {
        Row: {
          channel_number: number
          created_at: string
          dvr_id: string
          entregue_em: string | null
          error: string | null
          etapa: string | null
          expires_at: string
          id: string
          object_path: string
          ready_at: string | null
          recording_id: string
          server_id: string
          size_bytes: number | null
          state: string
          updated_at: string
          uploaded_bytes: number
        }
        Insert: {
          channel_number?: number
          created_at?: string
          dvr_id: string
          entregue_em?: string | null
          error?: string | null
          etapa?: string | null
          expires_at?: string
          id?: string
          object_path: string
          ready_at?: string | null
          recording_id: string
          server_id: string
          size_bytes?: number | null
          state?: string
          updated_at?: string
          uploaded_bytes?: number
        }
        Update: {
          channel_number?: number
          created_at?: string
          dvr_id?: string
          entregue_em?: string | null
          error?: string | null
          etapa?: string | null
          expires_at?: string
          id?: string
          object_path?: string
          ready_at?: string | null
          recording_id?: string
          server_id?: string
          size_bytes?: number | null
          state?: string
          updated_at?: string
          uploaded_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "recording_playback_exports_dvr_id_fkey"
            columns: ["dvr_id"]
            isOneToOne: false
            referencedRelation: "dvrs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recording_playback_exports_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "servidores"
            referencedColumns: ["id"]
          },
        ]
      }
      recording_playback_leases: {
        Row: {
          created_at: string
          expires_at: string
          export_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          export_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          export_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recording_playback_leases_export_id_fkey"
            columns: ["export_id"]
            isOneToOne: false
            referencedRelation: "recording_playback_exports"
            referencedColumns: ["id"]
          },
        ]
      }
      rondas: {
        Row: {
          ativo: boolean
          cliente_id: string | null
          created_at: string
          criado_por: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cliente_id?: string | null
          created_at?: string
          criado_por?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cliente_id?: string | null
          created_at?: string
          criado_por?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rondas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      rondas_itens: {
        Row: {
          created_at: string
          id: string
          layout_id: string
          ordem: number
          ronda_id: string
          segundos: number
        }
        Insert: {
          created_at?: string
          id?: string
          layout_id: string
          ordem?: number
          ronda_id: string
          segundos?: number
        }
        Update: {
          created_at?: string
          id?: string
          layout_id?: string
          ordem?: number
          ronda_id?: string
          segundos?: number
        }
        Relationships: [
          {
            foreignKeyName: "rondas_itens_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "layouts_visualizacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rondas_itens_ronda_id_fkey"
            columns: ["ronda_id"]
            isOneToOne: false
            referencedRelation: "rondas"
            referencedColumns: ["id"]
          },
        ]
      }
      servidores: {
        Row: {
          ativo: boolean
          base_url: string | null
          cliente_id: string
          config_atualizada_em: string
          created_at: string
          descricao: string | null
          disco_percentual: number | null
          id: string
          ip: string | null
          licenca: string | null
          metricas_agent: Json | null
          metricas_agent_em: string | null
          midia_gateway_online: boolean
          midia_hls_base: string | null
          midia_modo: string | null
          midia_webrtc: Json | null
          nome: string
          offline_apos_minutos: number
          online: boolean
          token: string | null
          ultimo_contato: string | null
          ultimo_payload: Json | null
          updated_at: string
          uptime_segundos: number | null
          versao: string | null
        }
        Insert: {
          ativo?: boolean
          base_url?: string | null
          cliente_id: string
          config_atualizada_em?: string
          created_at?: string
          descricao?: string | null
          disco_percentual?: number | null
          id?: string
          ip?: string | null
          licenca?: string | null
          metricas_agent?: Json | null
          metricas_agent_em?: string | null
          midia_gateway_online?: boolean
          midia_hls_base?: string | null
          midia_modo?: string | null
          midia_webrtc?: Json | null
          nome: string
          offline_apos_minutos?: number
          online?: boolean
          token?: string | null
          ultimo_contato?: string | null
          ultimo_payload?: Json | null
          updated_at?: string
          uptime_segundos?: number | null
          versao?: string | null
        }
        Update: {
          ativo?: boolean
          base_url?: string | null
          cliente_id?: string
          config_atualizada_em?: string
          created_at?: string
          descricao?: string | null
          disco_percentual?: number | null
          id?: string
          ip?: string | null
          licenca?: string | null
          metricas_agent?: Json | null
          metricas_agent_em?: string | null
          midia_gateway_online?: boolean
          midia_hls_base?: string | null
          midia_modo?: string | null
          midia_webrtc?: Json | null
          nome?: string
          offline_apos_minutos?: number
          online?: boolean
          token?: string | null
          ultimo_contato?: string | null
          ultimo_payload?: Json | null
          updated_at?: string
          uptime_segundos?: number | null
          versao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "servidores_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      sessoes_usuario: {
        Row: {
          cliente_id: string | null
          created_at: string
          forcado_em: string | null
          forcado_por: string | null
          id: string
          identificar_em: string | null
          identificar_rotulo: string | null
          layout_forcado: string | null
          layout_id: string | null
          rota: string
          sessao: string
          updated_at: string
          user_id: string
          visto_em: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          forcado_em?: string | null
          forcado_por?: string | null
          id?: string
          identificar_em?: string | null
          identificar_rotulo?: string | null
          layout_forcado?: string | null
          layout_id?: string | null
          rota?: string
          sessao: string
          updated_at?: string
          user_id: string
          visto_em?: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          forcado_em?: string | null
          forcado_por?: string | null
          id?: string
          identificar_em?: string | null
          identificar_rotulo?: string | null
          layout_forcado?: string | null
          layout_id?: string | null
          rota?: string
          sessao?: string
          updated_at?: string
          user_id?: string
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessoes_usuario_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessoes_usuario_layout_forcado_fkey"
            columns: ["layout_forcado"]
            isOneToOne: false
            referencedRelation: "layouts_visualizacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessoes_usuario_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "layouts_visualizacao"
            referencedColumns: ["id"]
          },
        ]
      }
      user_clientes: {
        Row: {
          cliente_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_clientes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string
          id: string
          permission: Database["public"]["Enums"]["app_permission"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission: Database["public"]["Enums"]["app_permission"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission?: Database["public"]["Enums"]["app_permission"]
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          sidebar_recolhida: boolean
          tema: string
          updated_at: string
          user_id: string
        }
        Insert: {
          sidebar_recolhida?: boolean
          tema?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          sidebar_recolhida?: boolean
          tema?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_sessions: {
        Row: {
          acao_reproducao: string | null
          answer_sdp: string | null
          canal: number
          cliente_sessao: string | null
          comando_em: string | null
          correlation_id: string | null
          created_at: string
          diagnostico: string | null
          dvr_id: string
          entregue_em: string | null
          espectadores: number
          estado: string
          expires_at: string
          hls_url: string | null
          id: string
          marcos_agente: Json | null
          modo: string
          offer_sdp: string | null
          path: string
          posicao_segundos: number | null
          qualidade: string
          entrega: string
          reconexoes: number
          recording_id: string | null
          servidor_id: string
          solicitado_por: string | null
          ultimo_sinal_agente: string | null
          updated_at: string
          velocidade: number | null
          whep_url: string | null
        }
        Insert: {
          acao_reproducao?: string | null
          answer_sdp?: string | null
          canal: number
          cliente_sessao?: string | null
          comando_em?: string | null
          correlation_id?: string | null
          created_at?: string
          diagnostico?: string | null
          dvr_id: string
          entregue_em?: string | null
          espectadores?: number
          estado?: string
          expires_at?: string
          hls_url?: string | null
          id?: string
          marcos_agente?: Json | null
          modo?: string
          offer_sdp?: string | null
          path: string
          posicao_segundos?: number | null
          qualidade?: string
          entrega?: string
          reconexoes?: number
          recording_id?: string | null
          servidor_id: string
          solicitado_por?: string | null
          ultimo_sinal_agente?: string | null
          updated_at?: string
          velocidade?: number | null
          whep_url?: string | null
        }
        Update: {
          acao_reproducao?: string | null
          answer_sdp?: string | null
          canal?: number
          cliente_sessao?: string | null
          comando_em?: string | null
          correlation_id?: string | null
          created_at?: string
          diagnostico?: string | null
          dvr_id?: string
          entregue_em?: string | null
          espectadores?: number
          estado?: string
          expires_at?: string
          hls_url?: string | null
          id?: string
          marcos_agente?: Json | null
          modo?: string
          offer_sdp?: string | null
          path?: string
          posicao_segundos?: number | null
          qualidade?: string
          entrega?: string
          reconexoes?: number
          recording_id?: string | null
          servidor_id?: string
          solicitado_por?: string | null
          ultimo_sinal_agente?: string | null
          updated_at?: string
          velocidade?: number | null
          whep_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_sessions_dvr_id_fkey"
            columns: ["dvr_id"]
            isOneToOne: false
            referencedRelation: "dvrs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_sessions_servidor_id_fkey"
            columns: ["servidor_id"]
            isOneToOne: false
            referencedRelation: "servidores"
            referencedColumns: ["id"]
          },
        ]
      }
      video_telemetria: {
        Row: {
          bytes_recebidos: number | null
          canal: number | null
          conexoes_ativas: number | null
          congelamentos: number | null
          connection_state: string | null
          correlation_id: string | null
          created_at: string
          dvr_id: string | null
          erro: string | null
          ice_connection_state: string | null
          id: string
          motivo_reconexao: string | null
          pacotes_recebidos: number | null
          pedidos_ativos: number | null
          quadros_decodificados: number | null
          qualidade: string | null
          rota: string | null
          session_id: string | null
          signaling_state: string | null
          tempos: Json | null
          tipo_candidato_local: string | null
          tipo_candidato_remoto: string | null
          ultimo_quadro_em: string | null
          usuario_id: string | null
        }
        Insert: {
          bytes_recebidos?: number | null
          canal?: number | null
          conexoes_ativas?: number | null
          congelamentos?: number | null
          connection_state?: string | null
          correlation_id?: string | null
          created_at?: string
          dvr_id?: string | null
          erro?: string | null
          ice_connection_state?: string | null
          id?: string
          motivo_reconexao?: string | null
          pacotes_recebidos?: number | null
          pedidos_ativos?: number | null
          quadros_decodificados?: number | null
          qualidade?: string | null
          rota?: string | null
          session_id?: string | null
          signaling_state?: string | null
          tempos?: Json | null
          tipo_candidato_local?: string | null
          tipo_candidato_remoto?: string | null
          ultimo_quadro_em?: string | null
          usuario_id?: string | null
        }
        Update: {
          bytes_recebidos?: number | null
          canal?: number | null
          conexoes_ativas?: number | null
          congelamentos?: number | null
          connection_state?: string | null
          correlation_id?: string | null
          created_at?: string
          dvr_id?: string | null
          erro?: string | null
          ice_connection_state?: string | null
          id?: string
          motivo_reconexao?: string | null
          pacotes_recebidos?: number | null
          pedidos_ativos?: number | null
          quadros_decodificados?: number | null
          qualidade?: string | null
          rota?: string | null
          session_id?: string | null
          signaling_state?: string | null
          tempos?: Json | null
          tipo_candidato_local?: string | null
          tipo_candidato_remoto?: string | null
          ultimo_quadro_em?: string | null
          usuario_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_dvr_row: {
        Args: {
          _perfis_base: Database["public"]["Enums"]["app_role"][]
          _perfis_ids: string[]
          _user_id: string
        }
        Returns: boolean
      }
      has_permission: {
        Args: {
          _perm: Database["public"]["Enums"]["app_permission"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      marcar_offline_expirados: { Args: never; Returns: number }
      novo_codigo_licenca: { Args: never; Returns: string }
      regenerar_licenca_servidor: {
        Args: { _servidor_id: string }
        Returns: string
      }
      regenerar_token_servidor: {
        Args: { _servidor_id: string }
        Returns: string
      }
      registrar_heartbeat: {
        Args: {
          _disco?: number
          _dvrs?: Json
          _licenca: string
          _token: string
          _uptime?: number
          _versao?: string
        }
        Returns: Json
      }
      role_rank: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: number
      }
      user_can_view_dvr: {
        Args: { _dvr_id: string; _user_id: string }
        Returns: boolean
      }
      user_cliente_ids: { Args: { _user_id: string }; Returns: string[] }
      user_perfil_id: { Args: { _user_id: string }; Returns: string }
      user_role_rank: { Args: { _user_id: string }; Returns: number }
    }
    Enums: {
      app_permission:
        | "clientes.criar"
        | "clientes.editar"
        | "clientes.excluir"
        | "servidores.criar"
        | "servidores.editar"
        | "servidores.excluir"
        | "dvrs.criar"
        | "dvrs.editar"
        | "dvrs.excluir"
        | "usuarios.criar"
        | "usuarios.editar"
        | "usuarios.excluir"
        | "gravacoes.ver"
        | "relatorios.ver"
        | "personalizacao.editar"
        | "dashboard.ver"
        | "clientes.ver"
        | "servidores.ver"
        | "dvrs.ver"
        | "visualizacao.ver"
        | "ronda.ver"
        | "usuarios.ver"
        | "log.ver"
        | "personalizacao.ver"
        | "monitoramento.ver"
        | "mosaicos.ver"
      app_role: "master" | "admin" | "operador" | "visualizador"
      evento_tipo: "queda" | "retorno"
      licenca_status: "ativa" | "revogada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_permission: [
        "clientes.criar",
        "clientes.editar",
        "clientes.excluir",
        "servidores.criar",
        "servidores.editar",
        "servidores.excluir",
        "dvrs.criar",
        "dvrs.editar",
        "dvrs.excluir",
        "usuarios.criar",
        "usuarios.editar",
        "usuarios.excluir",
        "gravacoes.ver",
        "relatorios.ver",
        "personalizacao.editar",
        "dashboard.ver",
        "clientes.ver",
        "servidores.ver",
        "dvrs.ver",
        "visualizacao.ver",
        "ronda.ver",
        "usuarios.ver",
        "log.ver",
        "personalizacao.ver",
        "monitoramento.ver",
        "mosaicos.ver",
      ],
      app_role: ["master", "admin", "operador", "visualizador"],
      evento_tipo: ["queda", "retorno"],
      licenca_status: ["ativa", "revogada"],
    },
  },
} as const
