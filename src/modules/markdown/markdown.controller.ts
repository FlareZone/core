import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common'
import { ApiProperty, ApiQuery } from '@nestjs/swagger'
import { FastifyReply } from 'fastify'
import JSZip from 'jszip'
import { join } from 'path'
import { Readable } from 'stream'
import { Auth } from '~/common/decorator/auth.decorator'
import { HTTPDecorators } from '~/common/decorator/http.decorator'
import { ApiName } from '~/common/decorator/openapi.decorator'
import { CategoryModel } from '../category/category.model'
import { ArticleType, DataListDto } from './markdown.dto'
import { MarkdownYAMLProperty } from './markdown.interface'
import { MarkdownService } from './markdown.service'

@Controller('markdown')
@Auth()
@ApiName
export class MarkdownController {
  constructor(private readonly service: MarkdownService) {}

  @Post('/import')
  @ApiProperty({ description: '导入 Markdown with YAML 数据' })
  async importArticle(@Body() body: DataListDto) {
    const type = body.type

    switch (type) {
      case ArticleType.Post: {
        return await this.service.insertPostsToDb(body.data)
      }
      case ArticleType.Note: {
        return await this.service.insertNotesToDb(body.data)
      }
    }
  }

  @Get('/export')
  @ApiProperty({ description: '导出 Markdown with YAML 数据' })
  @ApiQuery({
    description: '导出的 md 文件名是否为 slug',
    name: 'slug',
    required: false,
    enum: ['0', '1'],
  })
  @HTTPDecorators.Bypass
  async exportArticleToMarkdown(
    @Res() reply: FastifyReply,
    @Query('slug') slug: string,
    @Query('yaml') yaml?: boolean,
    // 是否在第一行显示 文章标题
    @Query('show_title') showTitle?: boolean,
  ) {
    const allArticles = await this.service.extractAllArticle()
    const { notes, pages, posts } = allArticles

    const convertor = <
      T extends {
        text: string
        created?: Date
        modified: Date
        title: string
        slug?: string
      },
    >(
      item: T,
      extraMetaData: Record<string, any> = {},
    ): MarkdownYAMLProperty => {
      const meta = {
        created: item.created,
        modified: item.modified,
        title: item.title,
        slug: item.slug || item.title,
        ...extraMetaData,
      }
      return {
        meta,
        text: this.service.markdownBuilder(
          { meta, text: item.text },
          yaml,
          showTitle,
        ),
      }
    }
    // posts
    const convertPost = posts.map((post) =>
      convertor(post, {
        categories: (post.category as CategoryModel).name,
        type: 'Post',
        permalink: 'posts/' + post.slug,
      }),
    )
    const convertNote = notes.map((note) =>
      convertor(note, {
        mood: note.mood,
        weather: note.weather,
        id: note.nid,
        permalink: 'notes/' + note.nid,
        type: 'Note',
      }),
    )
    const convertPage = pages.map((page) =>
      convertor(page, {
        subtitle: page.subtitle,
        type: 'Page',
        permalink: page.slug,
      }),
    )

    // zip
    const map = {
      posts: convertPost,
      pages: convertPage,
      notes: convertNote,
    }

    const rtzip = new JSZip()

    await Promise.all(
      Object.entries(map).map(async ([key, arr]) => {
        const zip = await this.service.generateArchive({
          documents: arr,
          archiveName: key,
          options: {
            slug: !!parseInt(slug),
          },
        })

        zip.forEach(async (relativePath, file) => {
          rtzip.file(join(key, relativePath), file.nodeStream())
        })
      }),
    )

    const readable = new Readable()
    readable.push(await rtzip.generateAsync({ type: 'nodebuffer' }))
    readable.push(null)

    reply
      .header(
        'Content-Disposition',
        `attachment; filename="markdown-${new Date().toISOString()}.zip"`,
      )
      .type('application/zip')
      .send(readable)
  }
}